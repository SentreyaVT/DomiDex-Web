import crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { aggregateVote } from './knowledge-aggregate.js';
import { isCurrentEvidence } from './current-evidence.js';

initializeApp();

export const aggregateScanKnowledge = onDocumentWritten(
  { document: "users/{uid}/scanEvidence/{fingerprint}", region: "europe-west1", maxInstances: 10 },
  async event => {
    const evidence = event.data?.after?.data();
    if (!evidence) return;
    const { uid, fingerprint } = event.params;
    if (evidence.fingerprint !== fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) return;
    const db = getFirestore();
    const privateRef = db.doc(`scanKnowledgePrivate/${fingerprint}`);
    const contributorKey = crypto.createHash("sha256").update(uid).digest("hex");
    const contributorRef = privateRef.collection("contributors").doc(contributorKey);
    const publicRef = db.doc(`scanKnowledge/${fingerprint}`);

    await db.runTransaction(async transaction => {
      // Read inside this transaction: deleted/replaced evidence cannot be resurrected by delayed events.
      if (!await isCurrentEvidence(transaction, event.data.after, db.doc(`accountDeletionLocks/${uid}`))) return;
      const [summarySnapshot, contributorSnapshot] = await Promise.all([
        transaction.get(privateRef), transaction.get(contributorRef),
      ]);
      const previous = contributorSnapshot.data();
      const observedAtClient = Number(evidence.observedAtClient || 0);
      if (previous && Number(previous.observedAtClient || 0) >= observedAtClient) return;
      const nextVote = {
        cardId: String(evidence.confirmedCardId),
        corrected: evidence.corrected === true,
        sourceSetId: evidence.sourceSetId || null,
        cardNumber: String(evidence.cardNumber || ""),
        setCode: evidence.setCode || null,
      };
      const aggregate = aggregateVote(summarySnapshot.data(), previous, nextVote);
      transaction.set(privateRef, {
        ...aggregate.privateSummary,
        knowledgeVersion: Number(evidence.knowledgeVersion || 1),
        lastUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(contributorRef, {
        ...nextVote,
        observedAtClient,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(publicRef, {
        fingerprint,
        ...aggregate.publicKnowledge,
        knowledgeVersion: Number(evidence.knowledgeVersion || 1),
        lastUpdatedAt: FieldValue.serverTimestamp(),
      });
    });
  },
);
