---
layout: post
title: Goose: Part 1
tags: [frontpage, jekyll, blog]
image: '/images/posts/2.jpeg'
---

In this series I'll detail the design for a distributed
[causally consistent](https://jepsen.io/consistency/models/causal) key-value
database called goose. I've been developing this concept for some time as a
spiritual successor to [devicedb](https://github.com/jrife/devicedb), a 
distributed key-value database designed for edge applications. I don't have a
particular use in mind for goose; it's more of a way to explore the limits of
causal consistency.

# Background
As I mentioned above, this project is inspired heavily by my previous work on
[devicedb](https://github.com/jrife/devicedb). I developed devicedb to
provide an always-available data plane for edge gateways. Essentially it
allowed data synchronization between gateways and between gateways and the
cloud. Several gateways could be grouped into "sites" which typically
corresponded to a single physical location or LAN and gateways in a "site"
shared a "site database". Site databases were replicated to each gateway and
to the cloud service to which all gateways were connected. Devicedb supported
a set of simple operations for reading from and writing to a key-value map. Here
is a simplified view:

```
// Execute a batch of puts and deletes
// Operation is a put or delete
Batch([]Operation)
// Get these keys
Get(keys []string) []string
// Get keys matching this prefix
GetMatches(prefix string) [][2]string
```

Applications running on gateways could read and write to the key-value map via
their local devicedb daemon while devicedb ensures changes are synchronized
across gateways ensuring eventual consistency. 

## Problems With Devicedb
1. `Batch()` was not atomic. Well, it was on the gateway where it was executed,
   but other gateways may observe only part of the effects of an update batch
   as certain keys would be synchronized before others. In other words it did
   not guarantee a 
   [monotonic atomic view](https://jepsen.io/consistency/models/monotonic-atomic-view). This limited the utility of devicedb in many cases
   and made it difficult to guarantee that some invariant holds across several
   keys.
2. Causal consistency was only enforced on a per-key basis. The synchronization
   protocol would share key changes between gateways in essentially a random
   order. A gateway might observe an update to key `a` before an update to key
   `b` even though `b` was written before `a` on another gateway.
3. The data model was confusing and unintuitive. Each value was actually a
   multi-value register, a kind of
   [CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type).
   This data type basically presents users with several conflicting
   values for a single key and requires that they write some logic to "merge"
   these as part of their transaction. In most cases I found that users
   preferred to simply use a last-writer-wins merge strategy and didn't really
   want to write complicated merge logic.

# Objectives
1. I want to support 
   [MAV](https://jepsen.io/consistency/models/monotonic-atomic-view) such that
   all transactions are observed atomically on all replicas.
2. I want to support true
   [causal consistency](https://jepsen.io/consistency/models/causal) such that
   all transactions are observed in causal order on all replicas.

# Design
## Consistency Model
### Why Causal Consistency
Causal consistency

## Transaction Model
* Each transaction is applied atomically and in causal order.

## Interface

## Causal Log
* A mapping between nodes and transactions.
* Each transaction contains a causal context.
* The current causal context for a node is just the summary
  of its causal log: map node id to highest index in the causal log.
* Entries must be appended to the log in causal order, implying that an entry can be added to the log only after all causal dependencies are in the log.
* When an entry is generated its causal context (lamport clock) is configured to be max_index(log) + 1 where max_index is the highest known log entry index on any node.
  
## Synchronization
* Causal log synchonization protocol preserves causal consistency

func GetNextN(causalContext, n):
  nextN = []
  h = new min heap

  for each node:
    add causalLog[node][causalContext[node]+1] to h
    causalContext[node]++

  while len(nextN) < n and there are more entries to explore:
    next = h.Pop()
    nextN = append(nextN, next)
    node = node where next is from
    add causalLog[node][causalContext[node]+1] to h
    causalContext[node]++

  return nextN

## Compaction
For each implementation need to define these ops depending on data structure:

- Snapshot() -> state
- Merge(local_state, snapshot_state)

For KV transactions snapshot() would snapshot current KV map
Merge would merge snapshot map with local map (tombstones included)

Snapshot at C means
"This was the current state at this node after having experiened 
 the effects of all transactions implied by this causal context (C)".

On sync with node that last snapshotted at C:

If that node's context happened before my local context:
  - do nothing
  - implies that other node has no transactions unknown to us.
Else:
  - implies that other node has transactions unknown to us.
  if the other node's last snapshot context happened before local context:
    - do incremental update, we've seen all transactions in C
  else:
    - do snapshot merge, there are transactions in C unknown to local node.
      need to sync with that before incremental updates are possible.

## Tombstone Deletion (KV only)
All deletes replace value with a tombstone
Matrix clocks kept up to date during log sync.
If the transaction that produced a tombstone has been
observed by all nodes then delete the tombstone locally.

## Consider Lamport Clocks
- More efficient
- If a transaction really happened before another transaction 
  then the c1 < c2.

a hb b -> la < lb
la < lb -> (a hb b) or (a || b)

## Data Structures
Value:
  Entry: (node, number) - used to determine log entry that led to this value
  Data: bytes