# DomiDex Collection Contract

This document records the Android-compatible Firestore contract used by DomiDex Web. The Android project was inspected read-only.

## Identity and ownership

- Firebase Authentication with a Google-linked Firebase user is the canonical collection identity.
- Path: `users/{uid}/collectionEntries/{syncId}`.
- `ownerUid` must equal the authenticated UID and the document ID must equal `syncId`.
- Source identity is the pair `sourceSetId` + `sourceCardId`; either both values are present or neither is.
- Cardmarket identity is the pair `externalProductSource = CARDMARKET_PUBLIC_DOWNLOAD` + `externalProductId`.

## Required mutation protocol

- Create starts at `revision = 1`.
- Update uses a transaction and writes exactly `previous revision + 1`.
- Every mutation has a new UUID in `lastMutationId`.
- `updatedAt` is a Firestore server timestamp and `updatedAtClient` is epoch milliseconds.
- Deletion is an immutable tombstone (`deleted = true`, `deletedAtClient` set). Documents are never physically deleted.
- A deleted document is never resurrected. Re-adding creates a new `syncId`.

## Collection fields

`syncId`, `ownerUid`, `revision`, `lastMutationId`, `updatedAt`, `updatedAtClient`, `deleted`, `deletedAtClient`, `name`, `setId`, `setName`, `collectorNumber`, `language`, `finish`, `variant`, `rarity`, `quantity`, `condition`, `notes`, `acquisitionPriceMinor`, `acquisitionCurrency`, `acquisitionDateEpochDay`, `externalProductSource`, `externalProductId`, `imageUrl`, `effectOverride`, `binderId`, `sourceSetId`, `sourceCardId`, `binderSetKey`, `binderName`, `binderHeroAsset`.

## Pricing

Firestore stores stable Cardmarket/source linkage, not a second market-price truth. Web resolves the current exact TCGdex/Cardmarket trend value from `sourceSetId`, `sourceCardId`, `finish` and `variant`. Missing or ambiguous prices remain unavailable.

## Conflict behavior

Web transactions reject stale revisions and retry against the latest snapshot. Android remains responsible for its local Room outbox and conflict UI; Web never writes Room-only sync state.
