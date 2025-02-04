---
title: Packet Scheduling With FQ
slug: qdisc-tuning
image: /images/posts/4/4.jpeg
description: >-
  Analyzing bimodal network throughput with iperf3, a 100 Gbit network, and the
  fair queueing qdisc.
tags:
  - networking
  - 100GbE
  - kernel
  - linux
  - ebpf
added: February 2 2025
---

Recently, I [set up](/post/100gbe) a 100 GbE home lab to use for learning,
experimentation, and development. In that post, I examined the source of
inconsistent iperf3 benchmark performance stemming from cache misses and
cross-core latency issues which I remedied by configuring IRQ affinity for my
network interface driver on the receive side.

Soon after, I encountered inconsistent benchmark performance again which I later
determined to be connected with the enablement of [IOMMU](https://en.wikipedia.org/wiki/Input%E2%80%93output_memory_management_unit) on my system and my choice of (or
rather configuration of) [queuing discipline](https://book.systemsapproach.org/congestion/queuing.html).
In this post, I'll explore the latter, diving deep into the [fq](https://man7.org/linux/man-pages/man8/tc-fq.8.html)
qdisc to understand its performance characterisics and determine how it could
lead to the behavior that I was seeing.

# My Goals

My mission from the start has been to achieve a stable, consistent, and clean
throughput when running iperf3. "Why?" you might ask, to which I would respond,
"Because I can, and it's fun." Optimizing microbenchmarks for its own sake is of
course an exercise in nerdy self indulgence with little practical benefit,
especially in a home lab where a 100 gigabit network is overkill to the nth
degree. However, the act of asking questions, peeling back the layers, and
digging deeper can be its own reward, leading to deeper understanding.

Speaking somewhat more practically, I *would* like to have a lab where I trust
that my baseline for performance (whatever that means for a particular
benchmark or metric) is consistent so that I can actually measure the effects
of whatever I'm tweaking or toggling.

Before I get too philosophical about purpose, existence, society, why anyone
does anything, or otherwise get too existential, let's jump into the interesting
bit. This is a tech blog, after all.

# The Problem: Bimodal Performance With iPerf3

I had disabled IOMMU after suspecting it was degrading benchmark performance 
over time, a problem which I plan to investigate in detail in my next post. With
IOMMU disabled in BIOS, I could now get a full 99.0 Gbits/sec that didn't seem
to degrade over time ... except when I didn't ...

Most runs looked like this,

```
jordan@crow:~/mlnx-tools/sbin$ iperf3 -c 192.168.88.3 -t 10 -A 6,6 
Connecting to host 192.168.88.3, port 5201
[  5] local 192.168.88.2 port 59006 connected to 192.168.88.3 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  11.3 GBytes  97.1 Gbits/sec   13   8.89 MBytes       
[  5]   1.00-2.00   sec  11.5 GBytes  99.0 Gbits/sec    0   8.18 MBytes       
[  5]   2.00-3.00   sec  11.5 GBytes  98.9 Gbits/sec    0   7.42 MBytes       
[  5]   3.00-4.00   sec  11.5 GBytes  99.0 Gbits/sec    0   6.81 MBytes       
[  5]   4.00-5.00   sec  11.5 GBytes  99.0 Gbits/sec    0   8.16 MBytes       
[  5]   5.00-6.00   sec  11.5 GBytes  99.0 Gbits/sec    0   6.37 MBytes       
[  5]   6.00-7.00   sec  11.5 GBytes  99.0 Gbits/sec    0   7.69 MBytes       
[  5]   7.00-8.00   sec  11.5 GBytes  99.0 Gbits/sec    0   8.71 MBytes       
[  5]   8.00-9.00   sec  11.5 GBytes  99.0 Gbits/sec    0   7.11 MBytes       
[  5]   9.00-10.00  sec  11.5 GBytes  99.0 Gbits/sec    0   8.10 MBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec   115 GBytes  98.8 Gbits/sec   13             sender
[  5]   0.00-10.00  sec   115 GBytes  98.8 Gbits/sec                  receiver

iperf Done.
```

with throughput topping out and stabilizing at 99.0 Gbits/sec fairly quickly,

```
jordan@crow:~/mlnx-tools/sbin$ iperf3 -c 192.168.88.3 -t 10 -A 6,6 
Connecting to host 192.168.88.3, port 5201
[  5] local 192.168.88.2 port 51624 connected to 192.168.88.3 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  9.47 GBytes  81.3 Gbits/sec   15   5.91 MBytes       
[  5]   1.00-2.00   sec  9.46 GBytes  81.3 Gbits/sec    0   5.62 MBytes       
[  5]   2.00-3.00   sec  9.43 GBytes  81.0 Gbits/sec    0   5.27 MBytes       
[  5]   3.00-4.00   sec  9.43 GBytes  81.0 Gbits/sec    0   5.49 MBytes       
[  5]   4.00-5.00   sec  9.45 GBytes  81.2 Gbits/sec    0   5.44 MBytes       
[  5]   5.00-6.00   sec  9.45 GBytes  81.2 Gbits/sec    0   5.95 MBytes       
[  5]   6.00-7.00   sec  9.43 GBytes  81.0 Gbits/sec    0   5.98 MBytes       
[  5]   7.00-8.00   sec  9.44 GBytes  81.1 Gbits/sec    0   5.95 MBytes       
[  5]   8.00-9.00   sec  9.45 GBytes  81.1 Gbits/sec    0   6.20 MBytes       
[  5]   9.00-10.00  sec  9.42 GBytes  80.9 Gbits/sec    0   6.59 MBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec  94.4 GBytes  81.1 Gbits/sec   15             sender
[  5]   0.00-10.00  sec  94.4 GBytes  81.1 Gbits/sec                  receiver

iperf Done.
```

while other runs (maybe 20%) seemed to get "stuck" at ~81 Gbits/sec. Sometimes
this self-corrected after ten seconds or so, but sometimes this persisted
indefinitely. This begged the question, "Why was iPerf3 getting stuck in a
'rut', and how could I avoid it?".

# Narrowing It Down

It wasn't immediately apparent to me that my choice of qdisc was to blame. After
days of head scratching, checking for packet drops on either side of the
connection, staring at [flame graphs](https://www.brendangregg.com/flamegraphs.html)
comparing fast and slow runs that looked roughly similar, and wondering if there
was a defect in my network cards, I vaguely remembered setting my default qdisc
(`net.core.default_qdisc`) to `fq` while messing around initially. Up until this
point I hadn't considered that this might be the culprit (I hesitate to call it
a bottleneck, since clearly I could achieve maximum throughput most of the
time). My leading theories had been that some unidentified cache latency or
locality issue was lurking, but checking and double-checking ensured that
everything was running on the same CCD (cores 6-11). My focus had been on the
receive side where CPU usage was much closer to 100% on core 6 where the iPerf3
server was running vs on the send side where CPU usage never seemed to exceed
50%. However, packet drops or throttling in the qdisc on the send side seemed
like a much more down-to-earth explanation, and the more I read the more it made
sense.

From the [man page](https://man7.org/linux/man-pages/man8/tc-fq.8.html):

> FQ (Fair Queue) is a classless packet scheduler meant to be mostly
> used for locally generated traffic.  It is designed to achieve per
> flow pacing.  FQ does flow separation, and is able to respect
> pacing requirements set by TCP stack.  All packets belonging to a
> socket are considered as a 'flow'.  For non local packets (router
> workload), packet hash is used as fallback.
> 
> An application can specify a maximum pacing rate using the
> SO_MAX_PACING_RATE setsockopt call.  This packet scheduler adds
> delay between packets to respect rate limitation set on each
> socket. Note that after linux-4.20, linux adopted EDT (Earliest
> Departure Time) and TCP directly sets the appropriate Departure
> Time for each skb.
> 
> Dequeueing happens in a round-robin fashion.  A special FIFO queue
> is reserved for high priority packets ( TC_PRIO_CONTROL priority),
> such packets are always dequeued first.
> 
> FQ is non-work-conserving.
> 
> TCP pacing is good for flows having idle times, as the congestion
> window permits TCP stack to queue a possibly large number of
> packets.  This removes the 'slow start after idle' choice, badly
> hitting large BDP flows and applications delivering chunks of data
> such as video streams.

It also describes several tuning paramters such as `flow_limit`, `quantum`, and
`maxrate` which impose restrictions on the number of packets that can be queued
for a particular flow, the number of bytes that can be dequeued at once, and
the maximum sending rate of a flow. It seemed possible, likely even, that
something was getting throttled or dropped here under certain conditions.

I decided to check out the qdisc stats for the network interface on the send
side.

```
jordan@crow:~$ sudo tc -s qdisc show dev enp1s0f0np0
qdisc mq 0: root 
 Sent 2647815981289 bytes 293764800 pkt (dropped 562, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
qdisc fq 0: parent :c limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 999149011620 bytes 110846042 pkt (dropped 281, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 12 (inactive 12 throttled 0)
  gc 0 highprio 0 throttled 5615521 latency 7us flows_plimit 281
qdisc fq 0: parent :b limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 30884903026 bytes 3426333 pkt (dropped 17, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 1 (inactive 1 throttled 0)
  gc 0 highprio 0 throttled 96032 latency 17.5us flows_plimit 17
qdisc fq 0: parent :a limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 66279573602 bytes 7352975 pkt (dropped 8, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 2 (inactive 2 throttled 0)
  gc 0 highprio 0 throttled 129784 latency 1.11us flows_plimit 8
qdisc fq 0: parent :9 limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 63677042050 bytes 7064247 pkt (dropped 14, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 2 (inactive 2 throttled 0)
  gc 0 highprio 0 throttled 221113 latency 827ns flows_plimit 14
qdisc fq 0: parent :8 limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 29493294788 bytes 3271950 pkt (dropped 3, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 1 (inactive 1 throttled 0)
  gc 0 highprio 0 throttled 60374 latency 470ns flows_plimit 3
qdisc fq 0: parent :7 limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 180348470759 bytes 20009823 pkt (dropped 51, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 12 (inactive 12 throttled 0)
  gc 0 highprio 0 throttled 255740 latency 7.7us flows_plimit 51
qdisc fq 0: parent :6 limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 475223836066 bytes 52732563 pkt (dropped 4, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 2 (inactive 2 throttled 0)
  gc 0 highprio 0 throttled 3309079 latency 4.17us flows_plimit 4
qdisc fq 0: parent :5 limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 155388786130 bytes 17238615 pkt (dropped 48, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 2 (inactive 2 throttled 0)
  gc 0 highprio 0 throttled 384770 latency 1.37us flows_plimit 48
qdisc fq 0: parent :4 limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 353576297182 bytes 39227209 pkt (dropped 88, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 3 (inactive 3 throttled 0)
  gc 0 highprio 0 throttled 756766 latency 56.9us flows_plimit 88
qdisc fq 0: parent :3 limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 602 bytes 9 pkt (dropped 0, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 0 (inactive 0 throttled 0)
  gc 0 highprio 0 throttled 0
qdisc fq 0: parent :2 limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 263648293068 bytes 29249910 pkt (dropped 48, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 4 (inactive 4 throttled 0)
  gc 0 highprio 0 throttled 613034 latency 1.73us flows_plimit 48
qdisc fq 0: parent :1 limit 10000p flow_limit 100p buckets 1024 orphan_mask 1023 quantum 18028b initial_quantum 90140b low_rate_threshold 550Kbit refill_delay 40ms timer_slack 10us horizon 10s horizon_drop 
 Sent 30146472396 bytes 3345124 pkt (dropped 0, overlimits 0 requeues 0) 
 backlog 0b 0p requeues 0
  flows 1 (inactive 1 throttled 0)
  gc 0 highprio 0 throttled 211073 latency 4.7us
```

Surprisingly, there weren't that many drops reported. The `flows_plimit` and
`throttled` stats seemed to increase with the bad runs, but I saw them increase
with the good runs too. It was hard to tell if there was much correlation by
just staring at these numbers. Still, my suspicions were raised. I decided to
disable fq and switch to the default qdisc, [`pfifo_fast`](https://man7.org/linux/man-pages/man8/tc-pfifo_fast.8.html),
to see if there was any difference in behavior. Sure enough, my benchmarks
consistently hit 99.0 Gbits/sec with no sign of the old bimodal distribution.

So job done, right? Wrong. Sure, there's no real reason for me to use fq.
After all, I didn't need to balance the rate of multipe flows. I just needed
iPerf3 (a single flow) to go fast. But my curiosity wasn't satisfied. It would
be one thing if it throttled me every time. It would be easy to chalk it up to
a queue length, `flows_plimit` perhaps, that was too short or a flow rate limit
being too low. This didn't readily explain the *inconsistencies* though. I
wanted to understand *why* some runs were fast, some were slow, why slowness
seemed "sticky" for lack of a better word, and whether this was indeed a
configuration issue (likely) or some inherent problem with fq (admittedly
unlikely). Regardless, I wanted to learn more. I reenabled fq and went about
investigating.

# Looking For Correlations

I set out looking for correlations between slow runs and any metrics or events I
could see related to the qdisc. I hoped to find some starting point that would
allow me to peel back the layers and uncover the conditions that led to these
slow runs. What was different between slow and fast, and why did iPerf3 get
stuck sometimes?

As stated above, I had observed an increase in the `flows_plimit` and
`throttled` stats during slow runs, but I also observed this during fast runs.
Perhaps there was a difference in ratios here, but a more obvious difference
caught my eye first.

## Tx Queues

For network cards supporting multiple *transmit queues*, Linux creates an mq
(multiqueue) qdisc which contains a *class* for each transmit queue into which
it places a *real* qdisc, fq in my case. The net effect in my case, as seen
above, is a qdisc and transmit queue for each CPU core. The kernel uses what is
called *transmit packet steering* (XPS) to determine the best transmit queue
based on several factors, most notably the current core. I don't consider myself
an expert on this (yet), but the long and short of it is that XPS maps CPU cores
to queues and chooses the transmit queue local to the current core when
(re)assigning the queue index for the current packet. This is a simplification,
there's more advanced mapping and configuration you can do, but I think the
explanation suffices for now. For more information, see the [docs](https://docs.kernel.org/networking/scaling.html#xps-transmit-packet-steering).

> Transmit Packet Steering is a mechanism for intelligently selecting which transmit queue to use when transmitting a packet on a multi-queue device. This can be accomplished by recording two kinds of maps, either a mapping of CPU to hardware queue(s) or a mapping of receive queue(s) to hardware transmit queue(s).

Going back to the "more obvious difference" I mentioned before, on slow runs I
observed counters increasing for *two* of these qdiscs on slow runs, whereas I
only observed counters increasing for *one* of these qdiscs on fast runs. The
two cores corresponded with the core to which I had pinned the iPerf3 client,
core six, and to which I had set the IRQ affinity for *all* IRQs, core eleven.
"Could flipping between different transmit queues (and hence cores) be
negatively impacting cache performance in some way, and if so could this be
triggered somehow by the fq qdisc?", I thought to myself. I would need to
understand when and how queue selection happens and under what conditions the
queue selection for a flow changes to determine if this was a clue or a red
herring.

### Choosing A Queue: `netdev_pick_tx()`

After reading through the kernel code a bit I found the function that selects
and assigns the transmit queue for a packet, [`netdev_pick_tx()`](https://github.com/torvalds/linux/blob/0de63bb7d91975e73338300a57c54b93d3cc151c/net/core/dev.c#L4416).

```c
u16 netdev_pick_tx(struct net_device *dev, struct sk_buff *skb,
		     struct net_device *sb_dev)
{
	struct sock *sk = skb->sk;
	int queue_index = sk_tx_queue_get(sk);

	sb_dev = sb_dev ? : dev;

	if (queue_index < 0 || skb->ooo_okay ||
	    queue_index >= dev->real_num_tx_queues) {
		int new_index = get_xps_queue(dev, sb_dev, skb);

		if (new_index < 0)
			new_index = skb_tx_hash(dev, sb_dev, skb);

		if (queue_index != new_index && sk &&
		    sk_fullsock(sk) &&
		    rcu_access_pointer(sk->sk_dst_cache))
			sk_tx_queue_set(sk, new_index);

		queue_index = new_index;
	}

	return queue_index;
}
EXPORT_SYMBOL(netdev_pick_tx);
```

The code here is fairly straightforward.

```c
	struct sock *sk = skb->sk;
	int queue_index = sk_tx_queue_get(sk);
```

The first thing `netdev_pick_tx()` does is see if the current socket, `sk`, is
bound to a queue and extracts this index. Note that `sk_tx_queue_get(sk)` will
return -1 the first time around, as `sk->sk_tx_queue_mapping` is initially set
to `NO_QUEUE_MAPPING`.

```c
static inline void sk_tx_queue_set(struct sock *sk, int tx_queue)
{
	/* sk_tx_queue_mapping accept only upto a 16-bit value */
	if (WARN_ON_ONCE((unsigned short)tx_queue >= USHRT_MAX))
		return;
	/* Paired with READ_ONCE() in sk_tx_queue_get() and
	 * other WRITE_ONCE() because socket lock might be not held.
	 */
	WRITE_ONCE(sk->sk_tx_queue_mapping, tx_queue);
}

#define NO_QUEUE_MAPPING	USHRT_MAX

static inline void sk_tx_queue_clear(struct sock *sk)
{
	/* Paired with READ_ONCE() in sk_tx_queue_get() and
	 * other WRITE_ONCE() because socket lock might be not held.
	 */
	WRITE_ONCE(sk->sk_tx_queue_mapping, NO_QUEUE_MAPPING);
}

static inline int sk_tx_queue_get(const struct sock *sk)
{
	if (sk) {
		/* Paired with WRITE_ONCE() in sk_tx_queue_clear()
		 * and sk_tx_queue_set().
		 */
		int val = READ_ONCE(sk->sk_tx_queue_mapping);

		if (val != NO_QUEUE_MAPPING)
			return val;
	}
	return -1;
}
```

`netdev_pick_tx()` only picks a new queue index if one or more of the following
conditions is true:

* `queue_index < 0` - there is currently no queue assigned to this socket.
* `skb->ooo_okay` is set. We'll come back to what this actually means in a
  second.
* `queue_index >= dev->real_num_tx_queues` - the current queue index is not
  valid, there are only `dev->real_num_tx_queues` TX queues for this device.

```c
	if (queue_index < 0 || skb->ooo_okay ||
	    queue_index >= dev->real_num_tx_queues) {
```

I wanted to answer two questions:

1. Is `netdev_pick_tx()` changing the queue index? The answer seemed to be
   an obvious "yes", but I wanted to confirm this beyond a shadow of a doubt.
2. If so, under what conditions is it changing the queue index? Which of the
   above conditions is true?

### Enter `bpftrace`

[bpftrace](https://github.com/bpftrace/bpftrace) and [BCC](https://github.com/iovisor/bcc)
provide unparalleled debugging capabilities for the Linux kernel. Both are
essentially BPF *frontends*, converting a script or query to an associated set
of BPF instructions which are injected at various *tracepoints* throughout
the kernel. I use the term "tracepoint" loosely here, not strictly to refer to
Linux [Tracepoints](https://docs.kernel.org/trace/tracepoints.html) with a
capital T. Perhaps "attachment point" would be less confusing, but I digress.

I'll focus on bpftrace here, as it's the tool I used for the majority of my
debugging and data collection in the coming sections. This isn't a tutorial;
for anyone wanting to learn about bpftrace the [reference guide](https://github.com/bpftrace/bpftrace/blob/master/man/adoc/bpftrace.adoc)
is where I started. Suffice it to say, it's the perfect tool to enable me to
answer questions like the above, as it allows me to instrument just about any
function in the Linux kernel to inspect its arguments, return value etc. all
through the magic of eBPF and kprobes.

### Tracing `netdev_pick_tx()`

To answer the first question I presented above, I wrote this script.

```
#!/usr/bin/bpftrace

kprobe:netdev_pick_tx {
	$sk_buff = (struct sk_buff *) arg1;

	@queue_index_before_netdev_pick_tx[cpu] = $sk_buff->sk->__sk_common.skc_tx_queue_mapping;
}

kretprobe:netdev_pick_tx {
	if (@queue_index_before_netdev_pick_tx[cpu] != retval) {
		@queue_index_after_netdev_pick_tx[cpu,@queue_index_before_netdev_pick_tx[cpu]] = lhist(retval, 0, 11, 1);
	}
}

END {
	clear(@queue_index_before_netdev_pick_tx);
}
```

`kprobe:netdev_pick_tx` cretes a hook on `netdev_pick_tx()` that executes
whenever it's invoked. I simply capture the current queue mapping from the
socket associated with the packet. `kretprobe:netdev_pick_tx` creates a hook
that executes after `netdev_pick_tx()` returns. By comparing the return value,
`retval`, to the value I captured before I can see if the queue index was
changed.

Here was the output for a fast run:

```
jordan@crow:~/contexts/iperf3-profiling$ sudo ./count_queue_index_changes.bt 
Attaching 3 probes...
^C

@queue_index_after_netdev_pick_tx[6, 65535]: 
[6, 7)                 2 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@queue_index_after_netdev_pick_tx[6, 11]: 
[6, 7)                 5 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@queue_index_after_netdev_pick_tx[11, 6]: 
[11, ...)              6 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

```

The interpretation here is this:

* Core six initialized the queue_index *twice* flipping the queue index from 65535
  (`NO_QUEUE_MAPPING`) ) to six. `queue_index < 0` was true in these cases.
* Core six flipped the queue index from eleven to six five times.
* Core eleven flipped the queue index from six to eleven six times.

Adding some print statements in, it's clear that after the two cores "fight it
out" momentarily until eleven wins out.

In the slow runs, things never stabilize; cores six and eleven keep flipping
the queue index back and forth as they "compete" with each other.

```
@queue_index_after_netdev_pick_tx[6, 0]: 
[11, ...)             45 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@queue_index_after_netdev_pick_tx[6, 11]: 
[6, 7)                52 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@queue_index_after_netdev_pick_tx[11, 6]: 
[11, ...)             52 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
```

This is consistent with the pattern I saw before when inspecting the output from
`tc -s qdisc show`. Now to answer this question:

> 2. If so, under what conditions is it changing the queue index? Which of the
>    above conditions is true?

More specifically, I wanted to know if `skb->ooo_okay` was true whenever the
queue index flip flopped between six and eleven, so I slightly modified the
script.

```
#!/usr/bin/bpftrace

kprobe:netdev_pick_tx {
	$sk_buff = (struct sk_buff *) arg1;

	@queue_index_before_netdev_pick_tx[cpu] = $sk_buff->sk->__sk_common.skc_tx_queue_mapping;
	@ooo_okay_before_netdev_pick_tx[cpu] = $sk_buff->ooo_okay;
}

kretprobe:netdev_pick_tx {
	if (@queue_index_before_netdev_pick_tx[cpu] != retval) {
		@ooo_okay_during_flip[cpu,@queue_index_before_netdev_pick_tx[cpu],retval] = lhist(@ooo_okay_before_netdev_pick_tx[cpu], 0, 1, 1);
	}
}

END {
	clear(@queue_index_before_netdev_pick_tx);
	clear(@ooo_okay_before_netdev_pick_tx);
}
```

The output proved that every time it flipped, `sk_buff->ooo_okay` was true.

```
@ooo_okay_during_flip[6, 11, 6]: 
[1, ...)               8 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@ooo_okay_during_flip[11, 6, 11]: 
[1, ...)               8 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
```

Taking this one step further, I could even determine what the call stack looked
like on each core when it invoked `netdev_pick_tx()` to see how it got there.

```
#!/usr/bin/bpftrace

kprobe:netdev_pick_tx {
	@[cpu, kstack()] = count();
}
```

Here's a snippet from the end of the output:

```
@[11, 
    netdev_pick_tx+1
    netdev_core_pick_tx+79
    __dev_queue_xmit+418
    neigh_resolve_output+274
    ip_finish_output2+406
    __ip_finish_output+182
    ip_finish_output+41
    ip_output+95
    ip_local_out+97
    __ip_queue_xmit+398
    ip_queue_xmit+21
    __tcp_transmit_skb+2614
    tcp_write_xmit+1199
    __tcp_push_pending_frames+55
    tcp_rcv_established+625
    tcp_v4_do_rcv+361
    tcp_v4_rcv+2922
    ip_protocol_deliver_rcu+60
    ip_local_deliver_finish+119
    ip_local_deliver+110
    ip_sublist_rcv_finish+111
    ip_sublist_rcv+376
    ip_list_rcv+258
    __netif_receive_skb_list_core+557
    netif_receive_skb_list_internal+419
    napi_complete_done+116
    mlx5e_napi_poll+400
    __napi_poll+48
    net_rx_action+385
    handle_softirqs+216
    __irq_exit_rcu+217
    irq_exit_rcu+14
    common_interrupt+164
    asm_common_interrupt+39
    cpuidle_enter_state+218
    cpuidle_enter+46
    call_cpuidle+35
    cpuidle_idle_call+285
    do_idle+135
    cpu_startup_entry+42
    start_secondary+297
    secondary_startup_64_no_verify+388
]: 242782
@[6, 
    netdev_pick_tx+1
    netdev_core_pick_tx+79
    __dev_queue_xmit+418
    neigh_resolve_output+274
    ip_finish_output2+406
    __ip_finish_output+182
    ip_finish_output+41
    ip_output+95
    ip_local_out+97
    __ip_queue_xmit+398
    ip_queue_xmit+21
    __tcp_transmit_skb+2614
    tcp_write_xmit+1199
    __tcp_push_pending_frames+55
    tcp_rcv_established+625
    tcp_v4_do_rcv+361
    __release_sock+199
    release_sock+48
    tcp_sendmsg+55
    inet_sendmsg+66
    sock_write_iter+365
    vfs_write+982
    ksys_write+201
    __x64_sys_write+25
    x64_sys_call+126
    do_syscall_64+127
    entry_SYSCALL_64_after_hwframe+120
]: 599038
```

We can see core six largely responsible for sending traffic, or at least calling
`sendmsg()` which enqueues packets to the qdisc for later transmission, and
that's what we would expect since iPerf3 is pinned to core six. We see core
eleven handling the IRQs and RX from the network card (`mlx5e_napi_poll()`)
which makes sense, since IRQs were pinned to core eleven. But of course, it's
not true that one core is solely responsible for transmit and one is solely
responsible for receive. While receiving traffic, core eleven calls
`tcp_v4_do_rcv()` which can also dequeue and transmit packets.

### Understanding `sk_buff->ooo_okay`

I had established that the queue index for a flow flipped between cores only
when `sk_buff->ooo_okay` and that for some reason this happened much more
frequently on the fast runs. Whether this was causing the performance
difference or vice-versa remained to be seen. Next, I wanted to understand what
conditions led to `sk_buff->ooo_okay` being set. Luckiy, I didn't have to look
far. I found this snippet in the kernel docs:

> The queue chosen for transmitting a particular flow is saved in the
> corresponding socket structure for the flow (e.g. a TCP connection).
> This transmit queue is used for subsequent packets sent on the flow to
> prevent out of order (ooo) packets. The choice also amortizes the cost
> of calling get_xps_queues() over all packets in the flow. To avoid
> ooo packets, the queue for a flow can subsequently only be changed if
> skb->ooo_okay is set for a packet in the flow. This flag indicates that
> there are no outstanding packets in the flow, so the transmit queue can
> change without the risk of generating out of order packets. The
> transport layer is responsible for setting ooo_okay appropriately. TCP,
> for instance, sets the flag when all data for a connection has been
> acknowledged.

and this comment above the site where it's set in [`net/ipv4/tcp_output.c`](https://github.com/torvalds/linux/blob/0de63bb7d91975e73338300a57c54b93d3cc151c/net/ipv4/tcp_output.c#L1350).

```c
	/* We set skb->ooo_okay to one if this packet can select
	 * a different TX queue than prior packets of this flow,
	 * to avoid self inflicted reorders.
	 * The 'other' queue decision is based on current cpu number
	 * if XPS is enabled, or sk->sk_txhash otherwise.
	 * We can switch to another (and better) queue if:
	 * 1) No packet with payload is in qdisc/device queues.
	 *    Delays in TX completion can defeat the test
	 *    even if packets were already sent.
	 * 2) Or rtx queue is empty.
	 *    This mitigates above case if ACK packets for
	 *    all prior packets were already processed.
	 */
	skb->ooo_okay = sk_wmem_alloc_get(sk) < SKB_TRUESIZE(1) ||
			tcp_rtx_queue_empty(sk);
```

### Analysis

> This flag indicates that there are no outstanding packets in the flow

Putting this into context, it meant that on the faster runs I was more likely
to encounter a condition where no packets were pending processing. Knowing this,
it seemed much more likely that this flip-flopping was a *result* of slower
performance as opposed to the *cause*. In other words, with less throughput it
would be more likely that everything gets processed quickly increasing the
likelihood that this condition is true. To test this, I simply ran iPerf3 with
the `--bandwidth` parameter to limit bandwidth to 50 Gbits/sec after which I
observed the same flip-flopping.

This, I concluded, was a dead end and an *effect* rather than a *cause* of the
slower throughput.

## Am I Being Throttled?

