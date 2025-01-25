---
title: 100 GbE Lab
slug: 100gbe
image: /images/posts/3.jpeg
description: >-
  How I set up my 100 GbE home lab.
tags:
  - networking
  - 100GbE
added: January 20 2025
---

I've been meaning to set up a 100 gigabit home lab for a while to learn and
explore the world of high speed networking, and I've finally finished it! In
this post I'll give an overview of how I built a relatively minmal 100GbE lab
from conception to implementation to testing. I'll explore some of the gotchas
and challenges in setting up a stable foundation for 100 gigabit testing.

# Requirements

* **Discrete**: My apartment already has too much clutter. I didn't want to put
  a server rack in the middle of the bedroom I use as my home office, and I
  barely have space for my own clothes in my closet let alone a bunch of
  computer equipment :). This stuff would have to go on top of or under my desk,
  so I wanted something that was quiet and elegant looking.
* **Remotely Managed**: I wanted to be able to completely manage my lab when
  I'm not at home and recover from any issues that might otherwise require
  physical access to fix. I like to tinker with the kernel; if I do something
  stupid and a server won't boot up anymore I want to be able to fix it. I
  decided [IPMI](https://en.wikipedia.org/wiki/Intelligent_Platform_Management_Interface)
  was a must.
* **100 GbE**: I wanted a platform capable of saturating a 100 gigabit link
  between two machines. In particuar, I wanted to be able to saturate, or come
  close to saturating, a 100 gigabit link with a single core, since it would make
  observing the effects of small tweaks and changes quite clear to see as I
  pushed the limits of what the hardware could do. High clock speed and IPC was
  my priority when selecting a CPU. I also needed two 100 GbE NICs and a
  motherboard with enough PCIe lanes to make full use of the NIC.
* **Budget**: Around $4000 was my budget for the build.

# The Build

## Choosing A Case
I wanted something discrete that didn't scream "server". Something unobtrusive
that wouldn't look too out of place on top of or under my desk. This narrowed it
down to a normal PC case. Moreover, I wanted a smaller form factor since I'd
have two of these things side-by-side. The Lian Li A3-mATX caught my eye as a
budget option that fit my criteria.

## Choosing A CPU
I immediately gravitated towards AMD's more recent 9000 series CPUs. They
featured a high base clock speed (~4.4 GHz) and turbo boost up to ~5.5 GHz) with
the potential for more overclocking if needed. The benchmarks I read online
boasted impressive single-core performance compared to their older counterparts.
I took a brief look into AMD's EPYC line of CPUs, but compared to the Ryzen 9000
I couldn't find the right balance of high base clock speed, core count, and
cost. Not to mention most of the EPYC line of CPUs raise the cost of the
motherboard as well for features I didn't need (e.g. 4 PCIe 5.0 x16 slots).

The Ryzen 9 9950X provided four additional cores compared to the Ryzen 9 9900x,
but cost $200 more. I decided 12 cores was more than enough and went with the
9900x.

## Choosing A Motherboard
ASRock Rack's B650D4U line of server motherboards was a perfect fit for my
build. It's a standard mATX form factor that would fit nicely in my case with
built-in IPMI and support for Ryzen 9000 series CPUs. It was a no-brainer
considering my requirements and other choices. The more expensive B650D4U-2L2T
variant included two RJ45 10GbE ports but was $200 more expensive. I decided on
the B650D4U base model which only supports 1GbE out of the box, since I planned
on installing my own NIC anyway.

## Choosing A NIC
I really only considered Mellanox cards, as I had some previous experience with
them. Beyond the obvious need for 100 GbE I wanted a card that at least
supported SR-IOV and RoCE, two features I wanted to play around and experiment
with. Dual port was a bonus if I could find it for the right price, as I wanted
to play around with redundant and multipath setups. The Mellanox MCX516A-CCAT
fit the bill, and I was able to find a good deal.

![cards](/images/posts/3/cards.jpeg)

## Choosing A Switch
As of the time of me writing this, the MikroTik CRS504-4XQ-IN really is the only
game in town as far as affordable 100 gigabit networking goes. Strictly
speaking, I didn't *need* a switch but wanted one anyway for the future
possibilities that it offers.

I also needed a cheap 1 GbE switch to connect the built-in 1 GbE management and
data ports of each machine to my home network. The 100 GbE network would remain
isolated for the time being.

## Memory
I just looked for whatever I could find for cheap on eBay. I wanted at least 32
GB of memory per machine to start with. It gave me enough head room to run a few
VMs if I wanted without breaking the bank.

## Cooling
I just bought a standard CPU cooler and case fans. One special consideration I
needed to make was cooling for the NICs themselves. With a passive cable, the
MCX516A-CCAT calls for 350LFM of airflow. Typically, these are installed into a
server chassis with a lot more airflow than my Lian Li A3-mATX and Thermalright
TL-C12C case fans would offer. I would need to actively cool the NICs somehow.
I decided on the tried and true method of zip tying a 40mm Noctua PWMNF-A4x20
PWM fan directly to the NIC's heat sink. This later proved to be effective.

![ziptied](/images/posts/3/ziptie.jpeg)

Here's the network card installed in an older PC I built. I was doing some
thermal testing to make sure the fan was keeping the NIC cool enough before the
rest of the parts arrived for my new build.

## Bill Of Materials

| Component             | Type                                             | Quantity | Price         |
| --------------------- | ------------------------------------------------ | -------- | ------------- |
| Case                  | Lian Li A3-mATX                                  | 2        | $69.99        |
| Case Fan (x3)         | Thermalright TL-C12C X3                          | 2        | $12.90        |
| Motherboard           | AsRock Rack B650D4U                              | 2        | $294.00       | 
| Power Supply          | Corsair RM750e                                   | 2        | $99.99        |
| CPU                   | AMD Ryzen 9 9900X                                | 2        | $439.00       |
| CPU Cooler            | Thermalright Peerless Assassin 120 SE            | 2        | $34.90        |
| Memory                | 4x16GB DDR5-4800 non-ECC UDIMM Hynix IC RAM      | 1        | $225.60       |
| SSD                   | Kingston NV2 1TB M.2 2280 NVMe Internal SSD      | 2        | $63.97        |
| Cat 8 RJ45 Cable      | UGREEN Cat 8 Ethernet Cable 6FT                  | 2        | $5.82         |
| QSFP28 100G DAC Cable | 1m (3ft) NVIDIA/Mellanox MCP1600-C001 Compatible | 2        | $32.00        |
| 100 GbE NIC           | NVIDIA Mellanox MCX516A-CCAT                     | 2        | $580.00       |
| NIC Fan               | Noctua PWMNF-A4x20 PWM                           | 2        | $14.95        |
| Zip Ties (x400)       | -                                                | 1        | $5.99         |
| 1 GbE Switch          | TP-Link TL-SG108E                                | 1        | $29.99        |
| 100 GbE Switch        | MikroTik CRS504-4XQ-IN                           | 1        | $641.36       |
|                       |                                                  |          | **$4,197.98** |

All told, the total came in at $4,197.98, but considering I was gifted some of
the components for Christmas I'll cheat and say I came in under budget. As I
mentioned, I could have gotten by without the MikroTik which would have brought
the total down to $3,556.62, but I wanted it :).

## Putting It All Together

Assembling everything was fairly mechanical. I installed the CPU, CPU cooler,
memory, NVMe drive, fans, etc. However, getting the first machine to boot proved
to be a challenge. I knew ahead of time that I would need to update the BIOS
before the system would post, as support for Ryzen 9000 series CPUs was only
introduced recently in version 20.01 of the [B650D4U BIOS](https://www.asrockrack.com/general/productdetail.asp?Model=B650D4U#Download). However, I couldn't even get a boot screen on an
external monitor or access the IPMI interface to flash a new BIOS image. I
assembled everything outside the case and *was* able to access the IPMI
interface to update the BIOS. I thought maybe it was just a fluke and maybe I
hadn't plugged something in all the way, so I moved everything back into the
case. But I had the same issue. After spending hours checking everything I
suspected a short. I noticed that when I unscrewed the motherboard and it lost
contact with the standoff screws IPMI would come up again. After much trial and
error I noticed a slight scratch around the middle standoff screw on the back
of the board, so I removed it completely and tried again. After that I didn't
have any problems and was able to finish the build of the first machine. I built
the second machine without any issues. I was much more careful not to damage
the motherboard while I was putting it into the case.

## The Result

![workspace1](/images/posts/3/workspace1.jpeg)

The look is fairly clean and unobtrusive. Even with both machines on, the noise
level is hardly noticeable. The loudest part of the setup is actually the fans
on the MikroTik which I have under my desk. Eventually I want to see if I can
replace its fans with something quieter. 

![front-machines](/images/posts/3/front-machines.jpeg)

On the back you can see the two RJ45 ethernet cables leading from the management
and data ports back to the 1 GbE switch connected to my home network. On the
bottom you can see the QSFP28 DAC cables connecting each box to the 100 GbE
switch.

![back-machines](/images/posts/3/back.jpeg)

I have one connection from the MikroTik's management port to the 1 GbE switch,
so that I can access the RouterOS admin interface. However, this port is not
bridged with the QSFP28 ports on the switch. 

![switches](/images/posts/3/switches.jpeg)

The switches sit on top of my old gaming PC build under my desk. I repurposed
that machine as a jumpbox, providing a Cloudflare tunnel into my home network
and allowing me to connect remotely. For the most part, this box stays up even
if I tinker with the other two.

![inside-the-machine](/images/posts/3/inside.jpeg)

And here's a look inside the case of the final build. You can see the Mellanox
card with the zip-tied fan. I only did enough cable management to keep the
cables from touching the fans inside the case.

# Testing

## Configuring The MikroTik

The first thing I did was make sure to update RouterOS to the latest version.
This amounted to downloading an image, uploading it to the switch through the
RouterOS web UI, and rebooting it. Next, I wanted to enable jumbo frames to give
myself the best chance of pushing 100 gigabits. To do this, I first set the MTU
of the default bridge to 9000. 

![bridge-mtu](/images/posts/3/bridge-mtu.png)

Next, I matched the MTU of each of the interfaces to that of the bridge.

![interface-mtu](/images/posts/3/interface-mtu.png)

RouterOS splits each physical QSFP28 port as four logical ports. If you're not
using a breakout cable to divide each port into two 50 Gb links or four 25 Gb
links you can ignore everything except qsfp28-1-1, qsfp28-2-1, etc.

![interface-list](/images/posts/3/interface-list.png)

Then I set the MTU on each machine to 9000 for the 100 Gb interfaces to fully
take advantage of jumbo frames.

```
jordan@crow:~$ ip link
...
4: enp1s0f0np0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 9000 qdisc mq state UP mode DEFAULT group default qlen 1000
    link/ether b8:3f:d2:ba:a6:a6 brd ff:ff:ff:ff:ff:ff
...
jordan@crow:~$ 
```

```
jordan@vulture:~$ ip link
...
4: enp1s0f0np0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 9000 qdisc mq state UP mode DEFAULT group default qlen 1000
...
jordan@vulture:~$ 
```

## Thermal Performance
Before doing any serious benchmarking I wanted to test the thermals. I was less
concerned with CPU thermals than NIC thermals. The
[spec sheet](https://docs.nvidia.com/networking/display/connectx5en/specifications#src-6881631_Specifications-MCX516A-CCATandMCX516A-CCHTSpecifications)
lists the operational temperature for the MCX516A-CCAT as 0°C to 55°C (32°F to
131°F). I suspected that I would need to actively cool the NIC to keep its
temperature within this range. To start, I simply installed the NIC without
any modification. Almost immediately after booting up and logging in I checked
the temperature.

```
jordan@vulture:~$ sensors -f
...
mlx5-pci-0100
Adapter: PCI adapter
sensor0:     +165.2°F  (crit = +221.0°F, highest = +165.2°F)
```

It was running way outside the specified range. I turned everything off to avoid
possibly damaging the card. I zip tied the 40mm Noctua fan onto the NIC's heat
sink and configured it to run at max speed before trying again.

![fan](/images/posts/3/fan.png)

The card then operated at a frosty 113°F. Even under load the temperature
remained steady. Even at full speed I barely registered the extra noise. The
CPU remained similarly cool.

```
jordan@vulture:~$ sensors -f
...
mlx5-pci-0100
Adapter: PCI adapter
sensor0:     +113.0°F  (crit = +221.0°F, highest = +113.0°F)
```

To anybody else trying this, I'd plan on strapping a fan to your NIC as well
unless you want to run your case fans at high speeds.

## Initial iperf3 Tests (Make Sure Things Are Plugged In)

My initial iperf3 tests were disappointing. I couldn't push more than 25 Gbps
between machines. I tried unplugging from the switch and directly connecting
my two servers with a DAC cable, but the result was the same. CPU utilization
on both machines remained low; no single core was more than ~25% active, so a
CPU bottleneck seemed unlikely. I tried running two instances of iperf3 across
different cores, but the aggregate throughput was still only ~25 Gbps. After an
hour of trying various tuning options and thinking I might have defective cards
I spotted this in the output of `lspci`.

```
        LnkSta:    Speed 8GT/s, Width x4 (downgraded)
            TrErr- Train- SlotClk+ DLActive- BWMgmt- ABWMgmt-
```

I only saw this on one of the machines. It seemed that only four of the 16 PCIe
lanes of the card were being used, so it would make sense that my bandwidth was
about 25% of the total capacity as well. I suspected an
[ID10T](https://en.wikipedia.org/wiki/User_error) error. Sure enough, I opened
up the case of the offending machine, pushed on the card a bit, and heard a nice
click. After booting the machine back up `lspci` showed all 16 lanes in use.

I was finally able to get ~100 Gbps of throughput across two iperf3 instances.
I plugged everything back into the switch and was able to get a similar result.

## Tuning Single-Core Performance

Now that I knew I could push 100 Gbps through my network cards and switch I went
back to single-core benchmarking. I wanted to make sure I had a stable and
consistent single-core baseline on top of which to test. Without a clean signal
it would be hard to measure the effects of other modifications to configuration,
the kernel, etc. that I wanted to make.

I observed extremely inconsistent results between runs. These generally fell
into three buckets: *worst (~65 Gbps)*, *better (~83 Gbps)*, and
*best (~99 Gbps)*.

### Worst
```
jordan@crow:~$ iperf3 -c 192.168.88.3 -t 10
Connecting to host 192.168.88.3, port 5201
[  5] local 192.168.88.2 port 57434 connected to 192.168.88.3 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  7.47 GBytes  64.2 Gbits/sec    7   2.49 MBytes       
[  5]   1.00-2.00   sec  7.53 GBytes  64.7 Gbits/sec    4   2.77 MBytes       
[  5]   2.00-3.00   sec  7.53 GBytes  64.7 Gbits/sec   13   3.15 MBytes       
[  5]   3.00-4.00   sec  7.53 GBytes  64.7 Gbits/sec    0   3.15 MBytes       
[  5]   4.00-5.00   sec  7.52 GBytes  64.6 Gbits/sec    0   3.15 MBytes       
[  5]   5.00-6.00   sec  7.52 GBytes  64.6 Gbits/sec    0   3.15 MBytes       
[  5]   6.00-7.00   sec  7.53 GBytes  64.7 Gbits/sec    0   3.15 MBytes       
[  5]   7.00-8.00   sec  7.57 GBytes  65.0 Gbits/sec    0   3.15 MBytes       
[  5]   8.00-9.00   sec  7.50 GBytes  64.4 Gbits/sec    0   3.16 MBytes       
[  5]   9.00-10.00  sec  7.51 GBytes  64.5 Gbits/sec    0   3.16 MBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec  75.2 GBytes  64.6 Gbits/sec   24             sender
[  5]   0.00-10.00  sec  75.2 GBytes  64.6 Gbits/sec                  receiver

iperf Done.
```

### Better
```
jordan@crow:~$ iperf3 -c 192.168.88.3 -t 10
Connecting to host 192.168.88.3, port 5201
[  5] local 192.168.88.2 port 54042 connected to 192.168.88.3 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  11.2 GBytes  95.7 Gbits/sec   49   8.09 MBytes       
[  5]   1.00-2.00   sec  9.74 GBytes  83.7 Gbits/sec    0   6.44 MBytes       
[  5]   2.00-3.00   sec  9.72 GBytes  83.6 Gbits/sec    0   5.96 MBytes       
[  5]   3.00-4.00   sec  9.76 GBytes  83.8 Gbits/sec    0   6.49 MBytes       
[  5]   4.00-5.00   sec  9.74 GBytes  83.7 Gbits/sec    0   6.15 MBytes       
[  5]   5.00-6.00   sec  9.74 GBytes  83.6 Gbits/sec    0   6.05 MBytes       
[  5]   6.00-7.00   sec  9.77 GBytes  83.9 Gbits/sec   15   6.14 MBytes       
[  5]   7.00-8.00   sec  9.74 GBytes  83.6 Gbits/sec    0   6.16 MBytes       
[  5]   8.00-9.00   sec  9.73 GBytes  83.6 Gbits/sec    0   5.73 MBytes       
[  5]   9.00-10.00  sec  9.75 GBytes  83.8 Gbits/sec    0   5.99 MBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec  98.9 GBytes  84.9 Gbits/sec   64             sender
[  5]   0.00-10.00  sec  98.8 GBytes  84.9 Gbits/sec                  receiver

iperf Done.
jordan@crow:~$ 
```

### Best
```
jordan@crow:~$ iperf3 -c 192.168.88.3 -t 10
Connecting to host 192.168.88.3, port 5201
[  5] local 192.168.88.2 port 35222 connected to 192.168.88.3 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  11.3 GBytes  97.1 Gbits/sec  124   10.0 MBytes       
[  5]   1.00-2.00   sec  11.5 GBytes  98.9 Gbits/sec    0   9.75 MBytes       
[  5]   2.00-3.00   sec  11.5 GBytes  98.8 Gbits/sec    0   8.77 MBytes       
[  5]   3.00-4.00   sec  11.5 GBytes  98.9 Gbits/sec    0   8.12 MBytes       
[  5]   4.00-5.00   sec  11.5 GBytes  98.9 Gbits/sec    0   10.5 MBytes       
[  5]   5.00-6.00   sec  11.5 GBytes  98.8 Gbits/sec    0   9.48 MBytes       
[  5]   6.00-7.00   sec  11.5 GBytes  99.0 Gbits/sec    0   8.33 MBytes       
[  5]   7.00-8.00   sec  11.5 GBytes  98.9 Gbits/sec    0   10.7 MBytes       
[  5]   8.00-9.00   sec  11.5 GBytes  98.9 Gbits/sec    0   9.96 MBytes       
[  5]   9.00-10.00  sec  11.5 GBytes  99.0 Gbits/sec    0   9.15 MBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec   115 GBytes  98.8 Gbits/sec  124             sender
[  5]   0.00-10.00  sec   115 GBytes  98.8 Gbits/sec                  receiver

iperf Done.
jordan@crow:~$ 
```

This was puzzling, so I started looking for something that correlated with this
pattern. Observing htop, a pattern soon emerged.

### Worst

![htop-worst](/images/posts/3/htop-worst.png)

These runs correlated with heavy activation on a single CPU core with little else. 

### Better

![htop-better](/images/posts/3/htop-better.png)

These runs correlated with activation on at least two CPU cores split between
cores 0-5 and 6-11. In other words, cores were active in both of these ranges.

### Best

![htop-best](/images/posts/3/htop-best.png)

These runs correlated with two or more cores active in either 0-5 or 6-11 but
not both.

Observing `/proc/interrupts` at the same time, I saw that the active cores
correlated to those being used to handle IRQs [1]. I suspected that some
cache-locality issue was to blame for the discrepency between the *better* and
*best* runs. After some research, I found that the cores on Ryzen CPUs are
split across different *CCDs* each with their own local L3 cache. In the case
of the 9900x, cores 0-5 belong to CCD 0 and cores 6-11 belong to CCD 1. There
is significant cross-core latency when cores across CCDs need to communicate. It
turns out that the cross-CCD latencies [were particularly bad](https://www.anandtech.com/show/21524/the-amd-ryzen-9-9950x-and-ryzen-9-9900x-review/3)
with the 9900X and 9950X with AMD later releasing a microcode update to address
this.

*[1] IRQs are interrupt requests. When a hardware device such as a NIC receives
data it triggers a hardware interrupt. The interrupt handler then does any work
that needs doing. In the case of networking devices, the driver needs to process
incoming packets and pass them along to the kernel's networking stack for
delivery or further processing. IRQs can be distributed across multiple cores.
This is a slight simplification, but gets the idea across. In reality hardware
interrupts are disabled once the kernel knows there is data pending until such
time that the kernel can process the packet backlog. See [NAPI](https://docs.kernel.org/networking/napi.html).*

Using this handy [core-to-core-latency](https://github.com/nviennot/core-to-core-latency)
tool I was able to measure latencies consistent with those I found in the wild.

```
jordan@vulture:~$ core-to-core-latency
CPU: AMD Ryzen 9 9900X 12-Core Processor
Num cores: 12
Num iterations per samples: 1000
Num samples: 300

1) CAS latency on a single shared cache line

           0       1       2       3       4       5       6       7       8       9      10      11   
      0
      1   19±0 
      2   19±0    20±0 
      3   20±0    18±0    21±0 
      4   19±0    21±0    18±0    20±0 
      5   22±0    19±0    19±0    21±0    22±0 
      6  214±0   221±0   214±0   221±0   207±0   213±0 
      7  222±0   219±0   224±0   219±0   217±0   225±0    20±0 
      8  210±0   228±0   206±0   226±0   207±0   209±0    19±0    22±0 
      9  219±0   228±0   216±0   219±0   210±0   216±0    21±0    19±0    22±0 
     10  211±0   214±0   208±0   212±0   216±0   217±0    20±0    23±0    20±0    20±0 
     11  215±0   216±0   214±0   217±0   211±0   214±0    23±0    21±0    20±0    23±0    23±0 

    Min  latency: 18.2ns ±0.0 cores: (4,2)
    Max  latency: 228.4ns ±0.4 cores: (8,1)
    Mean latency: 127.1ns
```

According to online reports, AMD's microcode update brings the latencies down
from ~220ns to a more reasonable 75ns; however, I'm not yet able to get this
update until ASRock Rack releases a BIOS update. Even so, to get the best
and most consistent single-core performance I'd need to make sure `iperf3 -s`
was running on the same CCD where IRQs are handled to get the best CPU cache
performance.

Comparing the the *worst* and *best* run, the difference seemed to be that in
the worst runs IRQs were being handled on the core running the iperf3 server
while in the best runs IRQs were processed on other cores on the same CCD. There
simply wasn't enough headroom on that core to process both without sacrificing
throughput. To ensure consistent results from this particular benchmark, I'd
also need to make sure to avoid handling IRQs on the same core where my iperf3
server was running.

By default the Mellanox driver (`mlx5_core`) distributes IRQs across all cores.

```
root@crow:/home/jordan# cat /proc/interrupts | grep mlx
  98:          0          0          0          0          0          0          0          0          0          0      23274          0  IR-PCI-MSIX-0000:01:00.0    0-edge      mlx5_async0@pci:0000:01:00.0
  99:        324          0          0          0          0          0          0       4360          0          0          0          0  IR-PCI-MSIX-0000:01:00.0    1-edge      mlx5_comp0@pci:0000:01:00.0
 101:          0          0          0          0          0          0          0          0          0          0          0       8563  IR-PCI-MSIX-0000:01:00.1    0-edge      mlx5_async0@pci:0000:01:00.1
 102:          0          0          0          0          0          0          0          0          0          0          0          0  IR-PCI-MSIX-0000:01:00.1    1-edge      mlx5_comp0@pci:0000:01:00.1
 109:          0          2          0          0          0          0          0          0     395218          0          0          0  IR-PCI-MSIX-0000:01:00.0    2-edge      mlx5_comp1@pci:0000:01:00.0
 110:          0          0          2          0          0          0          0          0          0     416057          0          0  IR-PCI-MSIX-0000:01:00.0    3-edge      mlx5_comp2@pci:0000:01:00.0
 111:          0          0          0          2          0          0          0          0          0          0          0          0  IR-PCI-MSIX-0000:01:00.0    4-edge      mlx5_comp3@pci:0000:01:00.0
 112:          0          0          0          0          2          0          0          0          0          0          0         12  IR-PCI-MSIX-0000:01:00.0    5-edge      mlx5_comp4@pci:0000:01:00.0
 113:          0          0          0          0          0          2          0         12          0          0          0          0  IR-PCI-MSIX-0000:01:00.0    6-edge      mlx5_comp5@pci:0000:01:00.0
 114:          0          0          0          0          0          0         10          0    1024467          0          0          0  IR-PCI-MSIX-0000:01:00.0    7-edge      mlx5_comp6@pci:0000:01:00.0
 115:          0          0          0          0          0          0          0          2          0     399417          0          0  IR-PCI-MSIX-0000:01:00.0    8-edge      mlx5_comp7@pci:0000:01:00.0
 116:          0          0          0          0          0          0          0          0          2          0     770067          0  IR-PCI-MSIX-0000:01:00.0    9-edge      mlx5_comp8@pci:0000:01:00.0
 117:          0          0          0          0          0          0          0          0          0          7          0     651437  IR-PCI-MSIX-0000:01:00.0   10-edge      mlx5_comp9@pci:0000:01:00.0
 118:          0          0          0          0          0          0          0     417457          0          0         22          0  IR-PCI-MSIX-0000:01:00.0   11-edge      mlx5_comp10@pci:0000:01:00.0
 119:          0          0          0          0          0          0          0          0     146064          0          0          2  IR-PCI-MSIX-0000:01:00.0   12-edge      mlx5_comp11@pci:0000:01:00.0
root@crow:/home/jordan# 
```

This can be tuned by setting the IRQ affinity for each of the interrupts to
choose the core where each IRQ is processed.

```
root@crow:/home/jordan# echo "800" > /proc/irq/119/smp_affinity
```

An easier alternative is to use the [mlnx-tools](https://github.com/Mellanox/mlnx-tools)
scripts which automate this. I used the `set_irq_affinity_cpulist.sh` script to
ensure that only cores 7-11 processed IRQs.

### Machine 1 (crow)
```
jordan@crow:~/mlnx-tools/sbin$ sudo ./set_irq_affinity_cpulist.sh 7-11 enp1s0f0np0
[sudo] password for jordan: 
Discovered irqs for enp1s0f0np0: 99 109 110 111 112 113 114 115 116 117 118 119
Assign irq 99 core_id 7
Assign irq 109 core_id 8
Assign irq 110 core_id 9
Assign irq 111 core_id 10
Assign irq 112 core_id 11
Assign irq 113 core_id 7
Assign irq 114 core_id 8
Assign irq 115 core_id 9
Assign irq 116 core_id 10
Assign irq 117 core_id 11
Assign irq 118 core_id 7
Assign irq 119 core_id 8

done.
jordan@crow:~/mlnx-tools/sbin$
```

### Machine 2 (vulture)
```
jordan@vulture:~/mlnx-tools/sbin$ sudo ./set_irq_affinity_cpulist.sh 7-11 enp1s0f0np0 
[sudo] password for jordan: 
Discovered irqs for enp1s0f0np0: 103 113 114 115 116 117 118 119 120 121 122 123
Assign irq 103 core_id 7
Assign irq 113 core_id 8
Assign irq 114 core_id 9
Assign irq 115 core_id 10
Assign irq 116 core_id 11
Assign irq 117 core_id 7
Assign irq 118 core_id 8
Assign irq 119 core_id 9
Assign irq 120 core_id 10
Assign irq 121 core_id 11
Assign irq 122 core_id 7
Assign irq 123 core_id 8

done.
jordan@vulture:~/mlnx-tools/sbin$
```

I tried running iperf3 again pinning both the client and the server to core six
on their respective machines.

```
jordan@crow:~/mlnx-tools/sbin$ iperf3 -c 192.168.88.3 -t 60 -A 6,6
Connecting to host 192.168.88.3, port 5201
[  5] local 192.168.88.2 port 39122 connected to 192.168.88.3 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  10.9 GBytes  93.6 Gbits/sec   24   8.80 MBytes       
[  5]   1.00-2.00   sec  11.5 GBytes  99.0 Gbits/sec    0   8.00 MBytes       
[  5]   2.00-3.00   sec  11.2 GBytes  95.7 Gbits/sec   11   7.41 MBytes       
[  5]   3.00-4.00   sec  11.5 GBytes  98.6 Gbits/sec    1   8.54 MBytes       
[  5]   4.00-5.00   sec  11.5 GBytes  99.0 Gbits/sec    0   10.7 MBytes       
[  5]   5.00-6.00   sec  11.5 GBytes  98.8 Gbits/sec    1   7.83 MBytes       
[  5]   6.00-7.00   sec  11.5 GBytes  98.9 Gbits/sec    1   7.81 MBytes       
[  5]   7.00-8.00   sec  11.4 GBytes  97.9 Gbits/sec    2   7.65 MBytes       
[  5]   8.00-9.00   sec  11.5 GBytes  99.0 Gbits/sec    1   8.11 MBytes       
[  5]   9.00-10.00  sec  11.3 GBytes  97.1 Gbits/sec    3   6.48 MBytes       
[  5]  10.00-11.00  sec  11.5 GBytes  98.5 Gbits/sec    2   7.98 MBytes       
[  5]  11.00-12.00  sec  11.5 GBytes  99.0 Gbits/sec    0   10.6 MBytes       
[  5]  12.00-13.00  sec  11.5 GBytes  99.0 Gbits/sec    0   10.1 MBytes       
[  5]  13.00-14.00  sec  11.5 GBytes  98.6 Gbits/sec    2   8.59 MBytes       
[  5]  14.00-15.00  sec  11.3 GBytes  96.9 Gbits/sec   14   6.48 MBytes       
[  5]  15.00-16.00  sec  11.5 GBytes  99.0 Gbits/sec    6   7.56 MBytes       
[  5]  16.00-17.00  sec  11.4 GBytes  98.3 Gbits/sec    3   7.54 MBytes       
[  5]  17.00-18.00  sec  11.5 GBytes  99.0 Gbits/sec    1   10.4 MBytes       
[  5]  18.00-19.00  sec  11.5 GBytes  99.0 Gbits/sec    0   7.38 MBytes       
[  5]  19.00-20.00  sec  11.5 GBytes  98.9 Gbits/sec    0   8.00 MBytes       
[  5]  20.00-21.00  sec  11.5 GBytes  99.0 Gbits/sec    0   8.55 MBytes       
[  5]  21.00-22.00  sec  11.5 GBytes  98.5 Gbits/sec    1   7.54 MBytes       
[  5]  22.00-23.00  sec  11.5 GBytes  99.0 Gbits/sec    0   7.14 MBytes       
[  5]  23.00-24.00  sec  11.5 GBytes  98.9 Gbits/sec    0   7.43 MBytes       
[  5]  24.00-25.00  sec  11.5 GBytes  99.0 Gbits/sec    0   7.72 MBytes       
[  5]  25.00-26.00  sec  11.4 GBytes  97.9 Gbits/sec    2   8.11 MBytes       
[  5]  26.00-27.00  sec  11.5 GBytes  98.9 Gbits/sec    1   8.79 MBytes       
[  5]  27.00-28.00  sec  11.5 GBytes  98.9 Gbits/sec    1   9.27 MBytes       
[  5]  28.00-29.00  sec  11.4 GBytes  98.3 Gbits/sec    1   7.87 MBytes       
[  5]  29.00-30.00  sec  11.5 GBytes  98.7 Gbits/sec    1   9.05 MBytes       
[  5]  30.00-31.00  sec  11.5 GBytes  99.0 Gbits/sec    0   6.95 MBytes       
[  5]  31.00-32.00  sec  11.5 GBytes  98.9 Gbits/sec    0   7.71 MBytes       
[  5]  32.00-33.00  sec  11.5 GBytes  99.0 Gbits/sec    0   8.65 MBytes       
[  5]  33.00-34.00  sec  11.4 GBytes  98.2 Gbits/sec    1   10.5 MBytes       
[  5]  34.00-35.00  sec  11.5 GBytes  98.6 Gbits/sec    2   7.48 MBytes       
[  5]  35.00-36.00  sec  11.5 GBytes  99.0 Gbits/sec    0   10.3 MBytes       
[  5]  36.00-37.00  sec  11.5 GBytes  99.0 Gbits/sec    0   6.85 MBytes       
[  5]  37.00-38.00  sec  11.5 GBytes  98.7 Gbits/sec   12   8.39 MBytes       
[  5]  38.00-39.00  sec  11.5 GBytes  98.6 Gbits/sec    1   4.10 MBytes       
[  5]  39.00-40.00  sec  11.4 GBytes  98.2 Gbits/sec    4   10.0 MBytes       
[  5]  40.00-41.00  sec  11.5 GBytes  99.0 Gbits/sec    2   9.11 MBytes       
[  5]  41.00-42.00  sec  11.5 GBytes  98.6 Gbits/sec    3   5.10 MBytes       
[  5]  42.00-43.00  sec  11.5 GBytes  98.5 Gbits/sec    1   8.82 MBytes       
[  5]  43.00-44.00  sec  11.5 GBytes  99.0 Gbits/sec    0   9.03 MBytes       
[  5]  44.00-45.00  sec  11.5 GBytes  98.5 Gbits/sec    1   7.17 MBytes       
[  5]  45.00-46.00  sec  11.5 GBytes  99.1 Gbits/sec    0   9.69 MBytes       
[  5]  46.00-47.00  sec  11.5 GBytes  99.0 Gbits/sec    0   9.21 MBytes       
[  5]  47.00-48.00  sec  11.5 GBytes  99.0 Gbits/sec    0   9.46 MBytes       
[  5]  48.00-49.00  sec  11.5 GBytes  98.9 Gbits/sec    1   9.57 MBytes       
[  5]  49.00-50.00  sec  11.5 GBytes  99.0 Gbits/sec    6   8.93 MBytes       
[  5]  50.00-51.00  sec  11.4 GBytes  98.3 Gbits/sec    2   6.60 MBytes       
[  5]  51.00-52.00  sec  11.5 GBytes  98.9 Gbits/sec    0   9.57 MBytes       
[  5]  52.00-53.00  sec  11.5 GBytes  98.9 Gbits/sec    0   8.88 MBytes       
[  5]  53.00-54.00  sec  11.5 GBytes  98.6 Gbits/sec    2   5.09 MBytes       
[  5]  54.00-55.00  sec  11.4 GBytes  98.2 Gbits/sec    1   8.41 MBytes       
[  5]  55.00-56.00  sec  11.5 GBytes  99.0 Gbits/sec    1   9.13 MBytes       
[  5]  56.00-57.00  sec  11.5 GBytes  98.6 Gbits/sec    2   5.16 MBytes       
[  5]  57.00-58.00  sec  11.5 GBytes  98.9 Gbits/sec    0   8.34 MBytes       
[  5]  58.00-59.00  sec  11.5 GBytes  98.3 Gbits/sec    2   8.52 MBytes       
[  5]  59.00-60.00  sec  11.4 GBytes  97.9 Gbits/sec    3   7.39 MBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-60.00  sec   688 GBytes  98.5 Gbits/sec  126             sender
[  5]   0.00-60.00  sec   688 GBytes  98.5 Gbits/sec                  receiver

iperf Done.
jordan@crow:~/mlnx-tools/sbin$ iperf3 -c 192.168.88.3 -t 60 -A 6,6
Connecting to host 192.168.88.3, port 5201
[  5] local 192.168.88.2 port 46964 connected to 192.168.88.3 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  10.9 GBytes  93.6 Gbits/sec   10   6.81 MBytes       
[  5]   1.00-2.00   sec  11.4 GBytes  98.1 Gbits/sec    3   6.72 MBytes       
[  5]   2.00-3.00   sec  11.5 GBytes  98.6 Gbits/sec    1   8.18 MBytes       
[  5]   3.00-4.00   sec  11.5 GBytes  99.0 Gbits/sec    1   8.87 MBytes       
[  5]   4.00-5.00   sec  11.4 GBytes  97.7 Gbits/sec    2   8.23 MBytes       
[  5]   5.00-6.00   sec  11.4 GBytes  98.2 Gbits/sec    2   7.99 MBytes       
[  5]   6.00-7.00   sec  11.5 GBytes  98.3 Gbits/sec    2   10.0 MBytes       
[  5]   7.00-8.00   sec  11.5 GBytes  99.0 Gbits/sec    0   9.28 MBytes       
[  5]   8.00-9.00   sec  11.5 GBytes  99.0 Gbits/sec    0   8.90 MBytes       
[  5]   9.00-10.00  sec  11.5 GBytes  99.0 Gbits/sec    0   8.38 MBytes       
[  5]  10.00-11.00  sec  11.5 GBytes  99.0 Gbits/sec    0   7.59 MBytes       
[  5]  11.00-12.00  sec  11.5 GBytes  98.9 Gbits/sec    0   10.3 MBytes       
[  5]  12.00-13.00  sec  11.5 GBytes  98.7 Gbits/sec    2   7.11 MBytes       
[  5]  13.00-14.00  sec  11.5 GBytes  98.9 Gbits/sec    1   7.36 MBytes       
[  5]  14.00-15.00  sec  11.6 GBytes  99.0 Gbits/sec    1   6.83 MBytes       
[  5]  15.00-16.00  sec  11.5 GBytes  99.0 Gbits/sec    0   9.69 MBytes       
[  5]  16.00-17.00  sec  11.5 GBytes  99.0 Gbits/sec    6   10.2 MBytes       
[  5]  17.00-18.00  sec  11.5 GBytes  98.6 Gbits/sec    1   10.8 MBytes       
[  5]  18.00-19.00  sec  11.4 GBytes  98.0 Gbits/sec    7   8.29 MBytes       
[  5]  19.00-20.00  sec  11.5 GBytes  99.0 Gbits/sec    1   7.97 MBytes       
[  5]  20.00-21.00  sec  11.5 GBytes  99.0 Gbits/sec    0   10.1 MBytes       
[  5]  21.00-22.00  sec  11.5 GBytes  99.0 Gbits/sec    0   9.00 MBytes       
[  5]  22.00-23.00  sec  11.4 GBytes  98.1 Gbits/sec    1   8.00 MBytes       
[  5]  23.00-24.00  sec  11.5 GBytes  98.6 Gbits/sec    1   8.90 MBytes       
[  5]  24.00-25.00  sec  11.5 GBytes  99.0 Gbits/sec    1   8.67 MBytes       
[  5]  25.00-26.00  sec  11.5 GBytes  98.9 Gbits/sec    1   9.34 MBytes       
[  5]  26.00-27.00  sec  11.4 GBytes  98.1 Gbits/sec    1   6.32 MBytes       
[  5]  27.00-28.00  sec  11.5 GBytes  98.5 Gbits/sec    0   8.35 MBytes       
[  5]  28.00-29.00  sec  11.5 GBytes  99.0 Gbits/sec    1   8.34 MBytes       
[  5]  29.00-30.00  sec  11.5 GBytes  98.9 Gbits/sec    1   8.52 MBytes       
[  5]  30.00-31.00  sec  11.5 GBytes  99.0 Gbits/sec    0   7.15 MBytes       
[  5]  31.00-32.00  sec  11.5 GBytes  99.0 Gbits/sec    0   10.3 MBytes       
[  5]  32.00-33.00  sec  11.5 GBytes  99.0 Gbits/sec    1   10.4 MBytes       
[  5]  33.00-34.00  sec  11.5 GBytes  98.8 Gbits/sec    1   7.54 MBytes       
[  5]  34.00-35.00  sec  11.5 GBytes  99.0 Gbits/sec    1   8.02 MBytes       
[  5]  35.00-36.00  sec  11.5 GBytes  98.5 Gbits/sec    1   9.22 MBytes       
[  5]  36.00-37.00  sec  11.5 GBytes  99.0 Gbits/sec    0   8.99 MBytes       
[  5]  37.00-38.00  sec  11.5 GBytes  98.5 Gbits/sec    1   6.74 MBytes       
[  5]  38.00-39.00  sec  11.4 GBytes  98.1 Gbits/sec    2   6.75 MBytes       
[  5]  39.00-40.00  sec  11.4 GBytes  97.6 Gbits/sec    7   8.54 MBytes       
[  5]  40.00-41.00  sec  11.4 GBytes  98.0 Gbits/sec    0   10.2 MBytes       
[  5]  41.00-42.00  sec  11.5 GBytes  99.1 Gbits/sec    0   9.98 MBytes       
[  5]  42.00-43.00  sec  11.5 GBytes  98.8 Gbits/sec    1   7.42 MBytes       
[  5]  43.00-44.00  sec  11.5 GBytes  99.0 Gbits/sec    1   7.33 MBytes       
[  5]  44.00-45.00  sec  11.5 GBytes  99.0 Gbits/sec    0   10.2 MBytes       
[  5]  45.00-46.00  sec  11.5 GBytes  98.9 Gbits/sec    0   9.76 MBytes       
[  5]  46.00-47.00  sec  11.5 GBytes  99.0 Gbits/sec    0   9.22 MBytes       
[  5]  47.00-48.00  sec  11.5 GBytes  99.0 Gbits/sec    0   8.49 MBytes       
[  5]  48.00-49.00  sec  11.5 GBytes  98.9 Gbits/sec    1   8.48 MBytes       
[  5]  49.00-50.00  sec  11.5 GBytes  98.9 Gbits/sec    1   8.79 MBytes       
[  5]  50.00-51.00  sec  11.5 GBytes  99.0 Gbits/sec    0   7.81 MBytes       
[  5]  51.00-52.00  sec  11.5 GBytes  98.9 Gbits/sec    6   8.18 MBytes       
[  5]  52.00-53.00  sec  11.5 GBytes  99.0 Gbits/sec    0   9.89 MBytes       
[  5]  53.00-54.00  sec  11.5 GBytes  98.9 Gbits/sec    1   6.51 MBytes       
[  5]  54.00-55.00  sec  11.5 GBytes  98.6 Gbits/sec    1   7.72 MBytes       
[  5]  55.00-56.00  sec  11.5 GBytes  98.7 Gbits/sec    1   8.94 MBytes       
[  5]  56.00-57.00  sec  11.5 GBytes  98.7 Gbits/sec    1   9.61 MBytes       
[  5]  57.00-58.00  sec  11.5 GBytes  99.0 Gbits/sec    0   9.98 MBytes       
[  5]  58.00-59.00  sec  11.5 GBytes  98.9 Gbits/sec    2   7.26 MBytes       
[  5]  59.00-60.00  sec  11.5 GBytes  98.9 Gbits/sec    1   7.77 MBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-60.00  sec   689 GBytes  98.7 Gbits/sec   78             sender
[  5]   0.00-60.00  sec   689 GBytes  98.6 Gbits/sec                  receiver

iperf Done.
```

I could now get a very consistent ~98.5 Gbps.

### Other Observations
During the course of tuning I discovered a BIOS setting that actually presents
the CCDs on the CPU as different [NUMA](https://en.wikipedia.org/wiki/Non-uniform_memory_access)
nodes. I thought this might improve things a bit without manual IRQ affinity
configuration, giving the operating system and driver some hint about cross-core
performance. Anecdotally, I seemed to get more of the *best* runs but still
occasionally saw the *worst* and *better* runs still. I'm not too familiar with
the Mellanox driver, so I'll have to do a bit of digging here to learn more.

# Conclusion
I'm happy the build was successful. I learned a lot through the tuning process
and now have a consistent and stable baseline on top of which to experiment
further with 100 Gb networking. In future posts I'm hoping to explore some more
topics related to high-speed networking and performance tuning/profiling.

*-Jordan*