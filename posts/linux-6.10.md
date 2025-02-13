---
title: NFS, eBPF, And The Kernel
slug: linux-6.10
image: /images/posts/2.jpeg
description: >-
  How I became a top contributor to the 6.10 kernel
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

![contributors](/images/posts/6.10-contributors.png)

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

![sds](/images/posts/sds.png)

In this architecture the service is used purely to provide a stable IP address
for the NFS mounts. If the NFS server pod needs to be replaced by the storage
system due to node restarts, pod deletions, etc. this allows any mounts to
recover as reconnection attempts on the client will be redirected to the new
backend.

![failover](/images/posts/failover.png)

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

![syscalls](/images/posts/syscallgraph.png)

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
in its original form (before I fixed it) simply invoked `connect()` like we saw
in `__sys_connect_file()`. `addr` is just a pointer to whatever parameter the
caller passes to `kernel_connect()`. As we know from the code above, however,
any BPF hooks that execute inside `tcp_v4_pre_connect()` may overwrite the
contents of `*addr`!

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

# Patching The Kernel
This was certainly problematic. The introduction of these BPF hooks had turned
`addr` into a mutable parameter breaking the expectations of code that used
functions like `kernel_connect()`. The fix itself was simple, just make a copy
of `*addr` to insulate callers of `kernel_connect()` from the effects of the BPF
hooks. This is just what my [initial patch](https://lore.kernel.org/netdev/20230821214523.720206-1-jrife@google.com/)
did.

## `kernel_connect()`
```diff
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

But I couldn't stop there. There turned out to be similar bugs in several of the
kernel space socket functions I mentioned above, namely `sock_sendmsg()`,
`kernel_bind()`. After some back-and-forth [this](https://lore.kernel.org/netdev/20230926200505.2804266-1-jrife@google.com/T/#u)
patch series was merged. In the case of `sock_sendmsg()` I was actually able to
confirm that it caused a similar bug with UDP-mode NFS mounts.

## `sock_sendmsg()`
```diff
--- a/net/socket.c
+++ b/net/socket.c
@@ -737,6 +737,14 @@ static inline int sock_sendmsg_nosec(struct socket *sock, struct msghdr *msg)
 	return ret;
 }
 
+static int __sock_sendmsg(struct socket *sock, struct msghdr *msg)
+{
+	int err = security_socket_sendmsg(sock, msg,
+					  msg_data_left(msg));
+
+	return err ?: sock_sendmsg_nosec(sock, msg);
+}
+
 /**
  *	sock_sendmsg - send a message through @sock
  *	@sock: socket
@@ -747,10 +755,21 @@ static inline int sock_sendmsg_nosec(struct socket *sock, struct msghdr *msg)
  */
 int sock_sendmsg(struct socket *sock, struct msghdr *msg)
 {
-	int err = security_socket_sendmsg(sock, msg,
-					  msg_data_left(msg));
+	struct sockaddr_storage *save_addr = (struct sockaddr_storage *)msg->msg_name;
+	int save_addrlen = msg->msg_namelen;
+	struct sockaddr_storage address;
+	int ret;
 
-	return err ?: sock_sendmsg_nosec(sock, msg);
+	if (msg->msg_name) {
+		memcpy(&address, msg->msg_name, msg->msg_namelen);
+		msg->msg_name = &address;
+	}
+
+	ret = __sock_sendmsg(sock, msg);
+	msg->msg_name = save_addr;
+	msg->msg_namelen = save_addrlen;
+
+	return ret;
 }
 EXPORT_SYMBOL(sock_sendmsg);
 
@@ -1138,7 +1157,7 @@ static ssize_t sock_write_iter(struct kiocb *iocb, struct iov_iter *from)
 	if (sock->type == SOCK_SEQPACKET)
 		msg.msg_flags |= MSG_EOR;
 
-	res = sock_sendmsg(sock, &msg);
+	res = __sock_sendmsg(sock, &msg);
 	*from = msg.msg_iter;
 	return res;
 }
@@ -2174,7 +2193,7 @@ int __sys_sendto(int fd, void __user *buff, size_t len, unsigned int flags,
 	if (sock->file->f_flags & O_NONBLOCK)
 		flags |= MSG_DONTWAIT;
 	msg.msg_flags = flags;
-	err = sock_sendmsg(sock, &msg);
+	err = __sock_sendmsg(sock, &msg);
 
 out_put:
 	fput_light(sock->file, fput_needed);
@@ -2538,7 +2557,7 @@ static int ____sys_sendmsg(struct socket *sock, struct msghdr *msg_sys,
 		err = sock_sendmsg_nosec(sock, msg_sys);
 		goto out_freectl;
 	}
-	err = sock_sendmsg(sock, msg_sys);
+	err = __sock_sendmsg(sock, msg_sys);
 	/*
 	 * If this is sendmmsg() and sending to current destination address was
 	 * successful, remember it.
```

## `kernel_bind()`
```diff
--- a/net/netfilter/ipvs/ip_vs_sync.c
+++ b/net/netfilter/ipvs/ip_vs_sync.c
@@ -1439,7 +1439,7 @@ static int bind_mcastif_addr(struct socket *sock, struct net_device *dev)
 	sin.sin_addr.s_addr  = addr;
 	sin.sin_port         = 0;
 
-	return sock->ops->bind(sock, (struct sockaddr*)&sin, sizeof(sin));
+	return kernel_bind(sock, (struct sockaddr *)&sin, sizeof(sin));
 }
 
 static void get_mcast_sockaddr(union ipvs_sockaddr *sa, int *salen,
@@ -1546,7 +1546,7 @@ static int make_receive_sock(struct netns_ipvs *ipvs, int id,
 
 	get_mcast_sockaddr(&mcast_addr, &salen, &ipvs->bcfg, id);
 	sock->sk->sk_bound_dev_if = dev->ifindex;
-	result = sock->ops->bind(sock, (struct sockaddr *)&mcast_addr, salen);
+	result = kernel_bind(sock, (struct sockaddr *)&mcast_addr, salen);
 	if (result < 0) {
 		pr_err("Error binding to the multicast addr\n");
 		goto error;
diff --git a/net/rds/tcp_connect.c b/net/rds/tcp_connect.c
index d788c6d28986f..a0046e99d6df7 100644
--- a/net/rds/tcp_connect.c
+++ b/net/rds/tcp_connect.c
@@ -145,7 +145,7 @@ int rds_tcp_conn_path_connect(struct rds_conn_path *cp)
 		addrlen = sizeof(sin);
 	}
 
-	ret = sock->ops->bind(sock, addr, addrlen);
+	ret = kernel_bind(sock, addr, addrlen);
 	if (ret) {
 		rdsdebug("bind failed with %d at address %pI6c\n",
 			 ret, &conn->c_laddr);
diff --git a/net/rds/tcp_listen.c b/net/rds/tcp_listen.c
index 014fa24418c12..53b3535a1e4a8 100644
--- a/net/rds/tcp_listen.c
+++ b/net/rds/tcp_listen.c
@@ -306,7 +306,7 @@ struct socket *rds_tcp_listen_init(struct net *net, bool isv6)
 		addr_len = sizeof(*sin);
 	}
 
-	ret = sock->ops->bind(sock, (struct sockaddr *)&ss, addr_len);
+	ret = kernel_bind(sock, (struct sockaddr *)&ss, addr_len);
 	if (ret < 0) {
 		rdsdebug("could not bind %s listener socket: %d\n",
 			 isv6 ? "IPv6" : "IPv4", ret);
diff --git a/net/socket.c b/net/socket.c
index 107a257a75186..3408bd6bb1e5a 100644
--- a/net/socket.c
+++ b/net/socket.c
@@ -3518,7 +3518,12 @@ static long compat_sock_ioctl(struct file *file, unsigned int cmd,
 
 int kernel_bind(struct socket *sock, struct sockaddr *addr, int addrlen)
 {
-	return READ_ONCE(sock->ops)->bind(sock, addr, addrlen);
+	struct sockaddr_storage address;
+
+	memcpy(&address, addr, addrlen);
+
+	return READ_ONCE(sock->ops)->bind(sock, (struct sockaddr *)&address,
+					  addrlen);
 }
 EXPORT_SYMBOL(kernel_bind);
```

## Patching Up The Call Sites
Exploring further, there were many raw calls to `sock->ops` throughout the
kernel. In other words, there were a lot of modules calling
`sock->ops->connect()`, `sock->ops->bind()`, etc. instead of using
`kernel_connect()`, `kernel_bind()`, etc. These individual call sites remained
susceptible to the kinds of bugs I had already addressed. I'd need to patch
these modules so that they used the safer alternatives. During the review of my
patch series, I had originally suggested pushing the `memcpy()` deeper into the
stack so even raw calls to `sock->ops` would be insulated, but the reviewers
felt that it's a cleaner solution to have the copy remain at the top level
(`kernel_connect()`, `kernel_bind()`, etc.).

In the same series I had already begun this process with changes to the IPVS and
RDS modules.

```diff
--- a/net/netfilter/ipvs/ip_vs_sync.c
+++ b/net/netfilter/ipvs/ip_vs_sync.c
@@ -1505,8 +1505,8 @@ static int make_send_sock(struct netns_ipvs *ipvs, int id,
 	}
 
 	get_mcast_sockaddr(&mcast_addr, &salen, &ipvs->mcfg, id);
-	result = sock->ops->connect(sock, (struct sockaddr *) &mcast_addr,
-				    salen, 0);
+	result = kernel_connect(sock, (struct sockaddr *)&mcast_addr,
+				salen, 0);
 	if (result < 0) {
 		pr_err("Error connecting to the multicast addr\n");
 		goto error;
diff --git a/net/rds/tcp_connect.c b/net/rds/tcp_connect.c
index f0c477c5d1db4..d788c6d28986f 100644
--- a/net/rds/tcp_connect.c
+++ b/net/rds/tcp_connect.c
@@ -173,7 +173,7 @@ int rds_tcp_conn_path_connect(struct rds_conn_path *cp)
 	 * own the socket
 	 */
 	rds_tcp_set_callbacks(sock, cp);
-	ret = sock->ops->connect(sock, addr, addrlen, O_NONBLOCK);
+	ret = kernel_connect(sock, addr, addrlen, O_NONBLOCK);
 
 	rdsdebug("connect to address %pI6c returned %d\n", &conn->c_faddr, ret);
 	if (ret == -EINPROGRESS)
```

But more patches were needed to fix up Ceph,

```diff
--- a/net/ceph/messenger.c
+++ b/net/ceph/messenger.c
@@ -459,8 +459,8 @@ int ceph_tcp_connect(struct ceph_connection *con)
 	set_sock_callbacks(sock, con);
 
 	con_sock_state_connecting(con);
-	ret = sock->ops->connect(sock, (struct sockaddr *)&ss, sizeof(ss),
-				 O_NONBLOCK);
+	ret = kernel_connect(sock, (struct sockaddr *)&ss, sizeof(ss),
+			     O_NONBLOCK);
 	if (ret == -EINPROGRESS) {
 		dout("connect %s EINPROGRESS sk_state = %u\n",
 		     ceph_pr_addr(&con->peer_addr),
```

SMB,

```diff
--- a/fs/smb/client/connect.c
+++ b/fs/smb/client/connect.c
@@ -2895,9 +2895,9 @@  bind_socket(struct TCP_Server_Info *server)
 	if (server->srcaddr.ss_family != AF_UNSPEC) {
 		/* Bind to the specified local IP address */
 		struct socket *socket = server->ssocket;
-		rc = socket->ops->bind(socket,
-				       (struct sockaddr *) &server->srcaddr,
-				       sizeof(server->srcaddr));
+		rc = kernel_bind(socket,
+				 (struct sockaddr *) &server->srcaddr,
+				 sizeof(server->srcaddr));
 		if (rc < 0) {
 			struct sockaddr_in *saddr4;
 			struct sockaddr_in6 *saddr6;
@@ -3046,8 +3046,8 @@  generic_ip_connect(struct TCP_Server_Info *server)
 		 socket->sk->sk_sndbuf,
 		 socket->sk->sk_rcvbuf, socket->sk->sk_rcvtimeo);
 
-	rc = socket->ops->connect(socket, saddr, slen,
-				  server->noblockcnt ? O_NONBLOCK : 0);
+	rc = kernel_connect(socket, saddr, slen,
+			    server->noblockcnt ? O_NONBLOCK : 0);
 	/*
 	 * When mounting SMB root file systems, we do not want to block in
 	 * connect. Otherwise bail out and then let cifs_reconnect() perform
```

and several others.

# The Saga Continues: Test Coverage
My job wasn't done yet. I had to make sure these issues remained fixed. There
turned out to be a rather extensive set of BPF tests
([`tools/testing/selftests/bpf`](https://github.com/torvalds/linux/tree/master/tools/testing/selftests/bpf))
which are run continuously from
[github.com/kernel-patches/bpf](https://github.com/kernel-patches/bpf). The
automation runs the BPF test suite across a range of architectures including
aarch64, s390x, and x86_64. I would need to extend this test suite to include
coverage for the issues that I had fixed.

My original [series](https://lore.kernel.org/bpf/20240429214529.2644801-1-jrife@google.com/T/#u)
extended existing tests for BPF sockaddr hooks to include coverage for
interactions between kernel socket functions (`kernel_connect()`, ...) and BPF
hooks which change the address parameter of the call. This required some
extensions to the BPF test kernel module. At the time, older non-CI-conformant
tests were in the process of being migrated to the new "prog_tests" style. I had
to fill some potholes to bridge the gap here, including this patch to make one
of the BPF programs used in the `kernel_bind()` tests compatible with big endian
architectures like s390x.

```diff
--- a/tools/testing/selftests/bpf/progs/bind4_prog.c
+++ b/tools/testing/selftests/bpf/progs/bind4_prog.c
@@ -12,6 +12,8 @@
 #include <bpf/bpf_helpers.h>
 #include <bpf/bpf_endian.h>
 
+#include "bind_prog.h"
+
 #define SERV4_IP		0xc0a801feU /* 192.168.1.254 */
 #define SERV4_PORT		4040
 #define SERV4_REWRITE_IP	0x7f000001U /* 127.0.0.1 */
@@ -118,23 +120,23 @@ int bind_v4_prog(struct bpf_sock_addr *ctx)
 
 	// u8 narrow loads:
 	user_ip4 = 0;
-	user_ip4 |= ((volatile __u8 *)&ctx->user_ip4)[0] << 0;
-	user_ip4 |= ((volatile __u8 *)&ctx->user_ip4)[1] << 8;
-	user_ip4 |= ((volatile __u8 *)&ctx->user_ip4)[2] << 16;
-	user_ip4 |= ((volatile __u8 *)&ctx->user_ip4)[3] << 24;
+	user_ip4 |= load_byte(ctx->user_ip4, 0, sizeof(user_ip4));
+	user_ip4 |= load_byte(ctx->user_ip4, 1, sizeof(user_ip4));
+	user_ip4 |= load_byte(ctx->user_ip4, 2, sizeof(user_ip4));
+	user_ip4 |= load_byte(ctx->user_ip4, 3, sizeof(user_ip4));
 	if (ctx->user_ip4 != user_ip4)
 		return 0;
 
 	user_port = 0;
-	user_port |= ((volatile __u8 *)&ctx->user_port)[0] << 0;
-	user_port |= ((volatile __u8 *)&ctx->user_port)[1] << 8;
+	user_port |= load_byte(ctx->user_port, 0, sizeof(user_port));
+	user_port |= load_byte(ctx->user_port, 1, sizeof(user_port));
 	if (ctx->user_port != user_port)
 		return 0;
 
 	// u16 narrow loads:
 	user_ip4 = 0;
-	user_ip4 |= ((volatile __u16 *)&ctx->user_ip4)[0] << 0;
-	user_ip4 |= ((volatile __u16 *)&ctx->user_ip4)[1] << 16;
+	user_ip4 |= load_word(ctx->user_ip4, 0, sizeof(user_ip4));
+	user_ip4 |= load_word(ctx->user_ip4, 1, sizeof(user_ip4));
 	if (ctx->user_ip4 != user_ip4)
 		return 0;
 
diff --git a/tools/testing/selftests/bpf/progs/bind6_prog.c b/tools/testing/selftests/bpf/progs/bind6_prog.c
index d62cd9e9cf0ea..9c86c712348cf 100644
--- a/tools/testing/selftests/bpf/progs/bind6_prog.c
+++ b/tools/testing/selftests/bpf/progs/bind6_prog.c
@@ -12,6 +12,8 @@
 #include <bpf/bpf_helpers.h>
 #include <bpf/bpf_endian.h>
 
+#include "bind_prog.h"
+
 #define SERV6_IP_0		0xfaceb00c /* face:b00c:1234:5678::abcd */
 #define SERV6_IP_1		0x12345678
 #define SERV6_IP_2		0x00000000
@@ -129,25 +131,25 @@ int bind_v6_prog(struct bpf_sock_addr *ctx)
 	// u8 narrow loads:
 	for (i = 0; i < 4; i++) {
 		user_ip6 = 0;
-		user_ip6 |= ((volatile __u8 *)&ctx->user_ip6[i])[0] << 0;
-		user_ip6 |= ((volatile __u8 *)&ctx->user_ip6[i])[1] << 8;
-		user_ip6 |= ((volatile __u8 *)&ctx->user_ip6[i])[2] << 16;
-		user_ip6 |= ((volatile __u8 *)&ctx->user_ip6[i])[3] << 24;
+		user_ip6 |= load_byte(ctx->user_ip6[i], 0, sizeof(user_ip6));
+		user_ip6 |= load_byte(ctx->user_ip6[i], 1, sizeof(user_ip6));
+		user_ip6 |= load_byte(ctx->user_ip6[i], 2, sizeof(user_ip6));
+		user_ip6 |= load_byte(ctx->user_ip6[i], 3, sizeof(user_ip6));
 		if (ctx->user_ip6[i] != user_ip6)
 			return 0;
 	}
 
 	user_port = 0;
-	user_port |= ((volatile __u8 *)&ctx->user_port)[0] << 0;
-	user_port |= ((volatile __u8 *)&ctx->user_port)[1] << 8;
+	user_port |= load_byte(ctx->user_port, 0, sizeof(user_port));
+	user_port |= load_byte(ctx->user_port, 1, sizeof(user_port));
 	if (ctx->user_port != user_port)
 		return 0;
 
 	// u16 narrow loads:
 	for (i = 0; i < 4; i++) {
 		user_ip6 = 0;
-		user_ip6 |= ((volatile __u16 *)&ctx->user_ip6[i])[0] << 0;
-		user_ip6 |= ((volatile __u16 *)&ctx->user_ip6[i])[1] << 16;
+		user_ip6 |= load_word(ctx->user_ip6[i], 0, sizeof(user_ip6));
+		user_ip6 |= load_word(ctx->user_ip6[i], 1, sizeof(user_ip6));
 		if (ctx->user_ip6[i] != user_ip6)
 			return 0;
 	}
diff --git a/tools/testing/selftests/bpf/progs/bind_prog.h b/tools/testing/selftests/bpf/progs/bind_prog.h
new file mode 100644
index 0000000000000..e830caa940c35
--- /dev/null
+++ b/tools/testing/selftests/bpf/progs/bind_prog.h
@@ -0,0 +1,19 @@
+/* SPDX-License-Identifier: GPL-2.0 */
+#ifndef __BIND_PROG_H__
+#define __BIND_PROG_H__
+
+#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
+#define load_byte(src, b, s) \
+	(((volatile __u8 *)&(src))[b] << 8 * b)
+#define load_word(src, w, s) \
+	(((volatile __u16 *)&(src))[w] << 16 * w)
+#elif __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__
+#define load_byte(src, b, s) \
+	(((volatile __u8 *)&(src))[(b) + (sizeof(src) - (s))] << 8 * ((s) - (b) - 1))
+#define load_word(src, w, s) \
+	(((volatile __u16 *)&(src))[w] << 16 * (((s) / 2) - (w) - 1))
+#else
+# error "Fix your compiler's __BYTE_ORDER__?!"
+#endif
+
+#endif
```

Shortly after this was merged, I finished a full migration of the old-style test
suite for BPF sockaddr hooks in [this](https://lore.kernel.org/bpf/20240510190246.3247730-1-jrife@google.com/T/#u)
patch series and fully retire the old test suite.

# Conclusion
This was my first *real* contribution to the kernel, other than a one line fix
for my laptop's touchpad driver in 2010, and I'm proud to have made a meaningful
impact. Interesting problems worth solving don't come along every day.

At this point, these patches have been backported to most major distros'
kernels and are generally available. I'm glad to say that the original bug with
Cilium and NFS has been completely and thoroughly squashed with Cilium's
[documentation](https://docs.cilium.io/en/latest/network/kubernetes/kubeproxy-free/#limitations)
even listing exact kernel versions for Ubuntu and RHEL that contain the fixes.

*-Jordan*
