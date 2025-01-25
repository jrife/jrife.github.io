---
title: How I Became a Top Contributor to The 6.10 Kernel
slug: linux-6.10
image: /images/posts/2.jpeg
description: >-
  Fixing bugs with eBPF SOCKADDR hooks.
tags:
  - kubernetes
  - kernel
  - ebpf
  - networking
  - storage
added: December 11 2024
---

OK, while this is *technically* true based on the [published](https://lwn.net/Articles/981559/)
statistics for the 6.10 Linux kernel, I'm hardly a core contribtor. But hey,
I wanted a catchy title.

![alt](/images/posts/6.10-contributors.png)

In 6.10 I made a large number of changes to the kernel selftests for BPF
sockaddr hooks to add regression coverage for a family of issues I fixed in
prior releases, so lots of ctrl-c+ctrl-v and refactoring of existing test code 
([1](https://lore.kernel.org/bpf/20240510190246.3247730-1-jrife@google.com/T/#u),
[2](https://lore.kernel.org/bpf/20240429214529.2644801-1-jrife@google.com/T/#u)).

In this post we'll take a look at these issues, how I fixed them, and find out
a bit more about the interactions between Kubernetes, Cilium, eBPF, and Linux
Kernel, and software-defined storage such as Portworx, Longhorn, etc.

# The Problem

Storage is an important component in many Kubernetes setups. There are a wide
variety of [CSI](https://kubernetes-csi.github.io/docs/) drivers that can
provide persistent storage to your cluster. These days, most storage appliance
vendors provide some CSI driver that enables Kubernetes clusters to connect to
their storage system. Some examples include:

* [Trident](https://docs.netapp.com/us-en/netapp-solutions/containers/rh-os-n_overview_trident.html)
  is NetApp's CSI driver.
* [CSI Powerstore](https://github.com/dell/csi-powerstore) is the CSI driver for
  Dell Powerstore.
* [Synology CSI](https://github.com/SynologyOpenSource/synology-csi) is the CSI
  driver for Synology NAS.

These drivers manage a storage appliance on behalf of a Kubernetes cluster to
make sure that `PersistentVolumeClaims`, `VolumeSnapshots`, etc. *just work*.

*Software-defined* storage systems such as [Longhorn](https://longhorn.io/),
[Portworx](https://portworx.com/), and [Robin](https://docs.robin.io/) provide
persistent storage to a Kubernetes cluster without a dedicated external storage
appliance. With these systems, data often lives on the the cluster nodes with
the storage system handling persistence, replication, and availability of data
across the cluster.

In Kubernetes volumes have an [*access mode*](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes)
which specifies how a volume can be mounted. For the purposes of this discussion
we'll focus on `ReadWriteMany` volumes and how they are implemented in these
software-defined storage systems.

> **ReadWriteMany**
>
> the volume can be mounted as read-write by many nodes.

Simply put, `ReadWriteMany` volumes are volumes that I can read and write to
from multiple nodes in my cluster at the same time. In theory this says nothing
about the implementation. In practice this usually means NFS, SMB, or some
distributed file system under the hood. *Technically* you can also provision and
use a `ReadWriteMany` volume with `volumeMode: Block` provided that the
underlying CSI driver supports it which allows multiple nodes to access a raw
block device, but this is much less common and typically access would need to be
orchestrated at the application level to prevent toe stepping.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
spec:
  accessModes:
  - ReadWriteMany
  volumeMode: Filesystem
  resources:
    requests:
      storage: 8Gi
```

All of the software-defined storage systems listed above implement
`ReadWriteMany` storage by creating up a user space NFS server
(e.g. [nfs-ganesha](https://github.com/nfs-ganesha/nfs-ganesha)) as a pod
beind a clusterIP [service](https://kubernetes.io/docs/concepts/services-networking/service/).

![alt](/images/posts/sds.png)

In this architecture the service is used purely to provide a stable IP address
for the NFS mounts. If the NFS server pod needs to be replaced by the storage
system due to node restarts, pod deletions, etc. this allows any mounts to
recover as reconnection attempts on the client will be redirected to the new
backend.

![alt](/images/posts/failover.png)

Traditionally, clusterIP services were implemented by [kube-proxy](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-proxy/),
a daemon that runs on each node in the cluster. kube-proxy creates iptables
rules for each service that DNAT a service's clusterIP (e.g. `10.0.0.80` in the
diagram above) to an endpoint IP (e.g. `192.168.0.54`). Netfilter then replaces
the service IP with an endpoint IP for each packet. However, this isn't the
only way to implement this concept. [Cilium](https://cilium.io/)'s socket-LB
feature implements clusterIP services using [eBPF](https://ebpf.io/) hooks
that execute on the `connect()`, `sendmsg()`, and `recvmsg()` system calls to
rewrite the address parameter. Using this approach the socket is connected
directly to a backend address, requiring no per-packet DNAT.

When disconnected from an NFS server, Linux periodically attempts to reconnect
to recover the NFS mount. When the NFS server address is a service IP
reconnection attempts *should* be directed to the new backend once it's ready.
This worked fine with kube-proxy or when using Cilium *without* socket-LB.
However, *with* socket-LB NFS mounts would get stuck if the original backend
was replaced [[1]](https://github.com/cilium/cilium/issues/21541). This turned out
to be caused by a deeper problem within the Linux kernel impacting the
interactions between the NFS (SUNRPC) driver and eBPF socket syscall hooks.

# eBPF + Socket Syscalls

This post isn't intended to be an eBPF primer. For those looking to learn more
[ebpf.io](https://ebpf.io/) is a good place to start. Suffice it to say that
eBPF in general is a way to attach small programs to hook points in the kernel
as a way to observe or influence system behavior in various ways. Here, we'll
be taking a look at the socket system call hooks used to implement Cilium's
socket-LB feature to better understand how they work and how they interact with
other subsystems in the kernel like NFS.

The NFS reconnection [bug](https://github.com/cilium/cilium/issues/21541) in
particular was a result of interactions between the SUNRPC module, the module
that manages client-server communications for NFS, and the eBPF hooks attached
to the [`connect()`](https://github.com/torvalds/linux/blob/a0e3919a2df29b373b19a8fbd6e4c4c38fc10d87/net/socket.c#L2077)
system call.

```c
/*
 *	Attempt to connect to a socket with the server address.  The address
 *	is in user space so we verify it is OK and move it to kernel space.
 *
 *	For 1003.1g we need to add clean support for a bind to AF_UNSPEC to
 *	break bindings
 *
 *	NOTE: 1003.1g draft 6.3 is broken with respect to AX.25/NetROM and
 *	other SEQPACKET protocols that take time to connect() as it doesn't
 *	include the -EINPROGRESS status for such sockets.
 */

int __sys_connect_file(struct file *file, struct sockaddr_storage *address,
		       int addrlen, int file_flags)
{
	struct socket *sock;
	int err;

	sock = sock_from_file(file);
	if (!sock) {
		err = -ENOTSOCK;
		goto out;
	}

	err =
	    security_socket_connect(sock, (struct sockaddr *)address, addrlen);
	if (err)
		goto out;

	err = READ_ONCE(sock->ops)->connect(sock, (struct sockaddr *)address,
				addrlen, sock->file->f_flags | file_flags);
out:
	return err;
}

int __sys_connect(int fd, struct sockaddr __user *uservaddr, int addrlen)
{
	int ret = -EBADF;
	struct fd f;

	f = fdget(fd);
	if (fd_file(f)) {
		struct sockaddr_storage address;

		ret = move_addr_to_kernel(uservaddr, addrlen, &address);
		if (!ret)
			ret = __sys_connect_file(fd_file(f), &address, addrlen, 0);
		fdput(f);
	}

	return ret;
}

SYSCALL_DEFINE3(connect, int, fd, struct sockaddr __user *, uservaddr,
		int, addrlen)
{
	return __sys_connect(fd, uservaddr, addrlen);
}
```

Any user space application wishing to make a connection invokes the `connect()`
syscall, usually indirectly via glibc or some other language-specific libraries,
passing in a `struct sockaddr *` containing the address to which it wants to
connect. OK, to be precise you can use the kernel's [`io_uring`](https://man7.org/linux/man-pages/man7/io_uring.7.html)
interface as well to interact with sockets, but let's ignore that for now. Note
that `__sys_connect()` actually moves the address from user space into
kernel space, copying the contents of `*uservaddr` into `address` before passing
a pointer to this copy down the stack.

```c
	err = READ_ONCE(sock->ops)->connect(sock, (struct sockaddr *)address,
				addrlen, sock->file->f_flags | file_flags);
```

The actual work gets done inside `__sys_connect_file()` where it calls
the connection `connect()` function, a member of `sock->ops` which is a
`struct proto_ops *`. As you might imagine there are different implementations
of `struct proto_ops *` for different protocol families and protocols.
[`inet_stream_connect()`](https://github.com/torvalds/linux/blob/a0e3919a2df29b373b19a8fbd6e4c4c38fc10d87/net/ipv4/af_inet.c#L742)
is the implementation of `connect()` for TCP sockets.

```c
/*
 *	Connect to a remote host. There is regrettably still a little
 *	TCP 'magic' in here.
 */
int __inet_stream_connect(struct socket *sock, struct sockaddr *uaddr,
			  int addr_len, int flags, int is_sendmsg)
{
	struct sock *sk = sock->sk;
	int err;
	long timeo;

	/*
	 * uaddr can be NULL and addr_len can be 0 if:
	 * sk is a TCP fastopen active socket and
	 * TCP_FASTOPEN_CONNECT sockopt is set and
	 * we already have a valid cookie for this socket.
	 * In this case, user can call write() after connect().
	 * write() will invoke tcp_sendmsg_fastopen() which calls
	 * __inet_stream_connect().
	 */
	if (uaddr) {
		if (addr_len < sizeof(uaddr->sa_family))
			return -EINVAL;

		if (uaddr->sa_family == AF_UNSPEC) {
			sk->sk_disconnects++;
			err = sk->sk_prot->disconnect(sk, flags);
			sock->state = err ? SS_DISCONNECTING : SS_UNCONNECTED;
			goto out;
		}
	}

	switch (sock->state) {
	default:
		err = -EINVAL;
		goto out;
	case SS_CONNECTED:
		err = -EISCONN;
		goto out;
	case SS_CONNECTING:
		if (inet_test_bit(DEFER_CONNECT, sk))
			err = is_sendmsg ? -EINPROGRESS : -EISCONN;
		else
			err = -EALREADY;
		/* Fall out of switch with err, set for this state */
		break;
	case SS_UNCONNECTED:
		err = -EISCONN;
		if (sk->sk_state != TCP_CLOSE)
			goto out;

		if (BPF_CGROUP_PRE_CONNECT_ENABLED(sk)) {
			err = sk->sk_prot->pre_connect(sk, uaddr, addr_len);
			if (err)
				goto out;
		}

		err = sk->sk_prot->connect(sk, uaddr, addr_len);
		if (err < 0)
			goto out;

		sock->state = SS_CONNECTING;

		if (!err && inet_test_bit(DEFER_CONNECT, sk))
			goto out;

		/* Just entered SS_CONNECTING state; the only
		 * difference is that return value in non-blocking
		 * case is EINPROGRESS, rather than EALREADY.
		 */
		err = -EINPROGRESS;
		break;
	}

	timeo = sock_sndtimeo(sk, flags & O_NONBLOCK);

	if ((1 << sk->sk_state) & (TCPF_SYN_SENT | TCPF_SYN_RECV)) {
		int writebias = (sk->sk_protocol == IPPROTO_TCP) &&
				tcp_sk(sk)->fastopen_req &&
				tcp_sk(sk)->fastopen_req->data ? 1 : 0;
		int dis = sk->sk_disconnects;

		/* Error code is set above */
		if (!timeo || !inet_wait_for_connect(sk, timeo, writebias))
			goto out;

		err = sock_intr_errno(timeo);
		if (signal_pending(current))
			goto out;

		if (dis != sk->sk_disconnects) {
			err = -EPIPE;
			goto out;
		}
	}

	/* Connection was closed by RST, timeout, ICMP error
	 * or another process disconnected us.
	 */
	if (sk->sk_state == TCP_CLOSE)
		goto sock_error;

	/* sk->sk_err may be not zero now, if RECVERR was ordered by user
	 * and error was received after socket entered established state.
	 * Hence, it is handled normally after connect() return successfully.
	 */

	sock->state = SS_CONNECTED;
	err = 0;
out:
	return err;

sock_error:
	err = sock_error(sk) ? : -ECONNABORTED;
	sock->state = SS_UNCONNECTED;
	sk->sk_disconnects++;
	if (sk->sk_prot->disconnect(sk, flags))
		sock->state = SS_DISCONNECTING;
	goto out;
}
EXPORT_SYMBOL(__inet_stream_connect);

int inet_stream_connect(struct socket *sock, struct sockaddr *uaddr,
			int addr_len, int flags)
{
	int err;

	lock_sock(sock->sk);
	err = __inet_stream_connect(sock, uaddr, addr_len, flags, 0);
	release_sock(sock->sk);
	return err;
}
EXPORT_SYMBOL(inet_stream_connect);
```

The interesting part for us is this section where `__inet_stream_connect()`
calls `sk->sk_prot->pre_connect()` which in the case of IPv4 TCP sockets
points to `tcp_v4_pre_connect()`.

```c
		if (BPF_CGROUP_PRE_CONNECT_ENABLED(sk)) {
			err = sk->sk_prot->pre_connect(sk, uaddr, addr_len);
			if (err)
				goto out;
		}
```

[`tcp_v4_pre_connect()`](https://github.com/torvalds/linux/blob/a0e3919a2df29b373b19a8fbd6e4c4c38fc10d87/net/ipv4/tcp_ipv4.c#L202)
invokes the BPF hook that can change the the address supplied to the `connect()`
system call (`uaddr`).

```c
static int tcp_v4_pre_connect(struct sock *sk, struct sockaddr *uaddr,
			      int addr_len)
{
	/* This check is replicated from tcp_v4_connect() and intended to
	 * prevent BPF program called below from accessing bytes that are out
	 * of the bound specified by user in addr_len.
	 */
	if (addr_len < sizeof(struct sockaddr_in))
		return -EINVAL;

	sock_owned_by_me(sk);

	return BPF_CGROUP_RUN_PROG_INET4_CONNECT(sk, uaddr, &addr_len);
}
```

To summarize, `BPF_CGROUP_RUN_PROG_INET4_CONNECT(sk, uaddr, &addr_len)` can
rewrite the address stored at `uaddr`, a pointer to the `address` variable
inside `__sys_connect()`.

![alt](/images/posts/syscallgraph.png)

If you try to connect to a the cluster IP of a service the address is rewritten
to one of that service's endpoint addresses. All of this works pretty seamlessly
for user space applications, but for NFS mounts to service IPs there's a catch.

# NFS (SUNRPC) + eBPF

The SUNRPC forms the foundation for communications between NFS clients and
servers. It implements the logic for forming connections and sending RPC calls
back and forth.

```c
static int xs_tcp_finish_connecting(struct rpc_xprt *xprt, struct socket *sock)
{
	struct sock_xprt *transport = container_of(xprt, struct sock_xprt, xprt);

	if (!transport->inet) {
		struct sock *sk = sock->sk;

		/* Avoid temporary address, they are bad for long-lived
		 * connections such as NFS mounts.
		 * RFC4941, section 3.6 suggests that:
		 *    Individual applications, which have specific
		 *    knowledge about the normal duration of connections,
		 *    MAY override this as appropriate.
		 */
		if (xs_addr(xprt)->sa_family == PF_INET6) {
			ip6_sock_set_addr_preferences(sk,
				IPV6_PREFER_SRC_PUBLIC);
		}

		xs_tcp_set_socket_timeouts(xprt, sock);
		tcp_sock_set_nodelay(sk);

		lock_sock(sk);

		xs_save_old_callbacks(transport, sk);

		sk->sk_user_data = xprt;
		sk->sk_data_ready = xs_data_ready;
		sk->sk_state_change = xs_tcp_state_change;
		sk->sk_write_space = xs_tcp_write_space;
		sk->sk_error_report = xs_error_report;
		sk->sk_use_task_frag = false;

		/* socket options */
		sock_reset_flag(sk, SOCK_LINGER);

		xprt_clear_connected(xprt);

		/* Reset to new socket */
		transport->sock = sock;
		transport->inet = sk;

		release_sock(sk);
	}

	if (!xprt_bound(xprt))
		return -ENOTCONN;

	xs_set_memalloc(xprt);

	xs_stream_start_connect(transport);

	/* Tell the socket layer to start connecting... */
	set_bit(XPRT_SOCK_CONNECTING, &transport->sock_state);
	return kernel_connect(sock, xs_addr(xprt), xprt->addrlen, O_NONBLOCK);
}
```

[`xs_tcp_finish_connecting()`](https://github.com/torvalds/linux/blob/a0e3919a2df29b373b19a8fbd6e4c4c38fc10d87/net/sunrpc/xprtsock.c#L2338)
is where the module actually establishes a connection with a function called
`kernel_connect()`. This being kernel space, we don't invoke system calls
directly as a user space application would. Instead, there are several kernel
space equivalents defined in [`net/socket.c`](https://github.com/torvalds/linux/blob/master/net/socket.c)
for manipulating sockets namely `kernel_bind()`, `kernel_listen()`,
`kernel_accept()`, `kernel_connect()`, `kernel_getsockname()`,
`kernel_getpeername()`, `kernel_sendmsg()`, `sock_sendmsg()`, and
`kernel_recvmsg()`.

```c
/**
 *	kernel_connect - connect a socket (kernel space)
 *	@sock: socket
 *	@addr: address
 *	@addrlen: address length
 *	@flags: flags (O_NONBLOCK, ...)
 *
 *	For datagram sockets, @addr is the address to which datagrams are sent
 *	by default, and the only address from which datagrams are received.
 *	For stream sockets, attempts to connect to @addr.
 *	Returns 0 or an error code.
 */

int kernel_connect(struct socket *sock, struct sockaddr *addr, int addrlen,
		   int flags)
{
	return READ_ONCE(sock->ops)->connect(sock, (struct sockaddr *)&address,
					     addrlen, flags);
}
EXPORT_SYMBOL(kernel_connect);
```

[`kernel_connect()`](https://github.com/torvalds/linux/blob/a0e3919a2df29b373b19a8fbd6e4c4c38fc10d87/net/socket.c#L3618)
in its original form (i.e. before I fixed it) simply invoked `connect()` like we
saw in `__sys_connect_file()`. `addr` is just a pointer to whatever parameter
the caller passes to `kernel_connect()`. As we know from the code above,
however, any BPF hooks that execute inside `tcp_v4_pre_connect()` may overwrite
the contents of `*addr`!

```c
  return kernel_connect(sock, xs_addr(xprt), xprt->addrlen, O_NONBLOCK);
```

Looking again at the call to `kernel_connect()` inside
`xs_tcp_finish_connecting()` we can quickly see what the issue is.

```c
static inline struct sockaddr *xs_addr(struct rpc_xprt *xprt)
{
	return (struct sockaddr *) &xprt->addr;
}
```

It so happens that the pointer being passed to the `addr` parameter of
`kernel_connect()` points to the server address of the NFS mount. With storage
systems like those described above this would be the cluster IP of the service
associated with a particular `ReadWriteMany` volume's NFS backend. When a mount
is created on a cluster node and the initial connection attempt is made Cilium's
BPF hooks would permanently rewrite the mount address to the initial NFS server
pod's IP. If this pod ever went away and was replaced by a new pod with a new
IP, the NFS mount would break forever trying to reconnect to the original pod's
IP. Running `mount` you could even see that the IP address printed for these
NFS mounts was the *pod* IP instead of the *service* IP.

This was certainly problematic. The introduction of these BPF hooks had turned
`addr` into a mutable parameter breaking the expectations of code that used
functions like `kernel_connect()`. The fix itself was simple, just make a copy
of `*addr` to insulate callers of `kernel_connect()` from the effects of the BPF
hooks. This is just what my [initial patch](https://lore.kernel.org/netdev/20230821214523.720206-1-jrife@google.com/)
did.

```
 int kernel_connect(struct socket *sock, struct sockaddr *addr, int addrlen,
 		   int flags)
 {
-	return READ_ONCE(sock->ops)->connect(sock, addr, addrlen, flags);
+	struct sockaddr_storage address;
+
+	memcpy(&address, addr, addrlen);
+
+	return READ_ONCE(sock->ops)->connect(sock, (struct sockaddr *)&address,
+					     addrlen, flags);
 }
 EXPORT_SYMBOL(kernel_connect);
```

TODO

