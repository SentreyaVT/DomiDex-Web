'use client';

import { useEffect, useState } from 'react';
import { subscribeCollectionLayouts, type SetBinderVisibility } from '@/lib/collection-layouts';

const emptyVisibility: SetBinderVisibility = new Map();

export function useCollectionLayouts(ownerUid?: string) {
  const [snapshot, setSnapshot] = useState<{ ownerUid: string; visibility: SetBinderVisibility; failed: boolean }>();
  useEffect(() => {
    let active = true;
    setSnapshot(undefined);
    if (!ownerUid) return;
    const fail = () => {
      if (active) setSnapshot((current) => ({ ownerUid, visibility: current?.ownerUid === ownerUid ? current.visibility : emptyVisibility, failed: true }));
    };
    let stop: (() => void) | undefined;
    void subscribeCollectionLayouts(ownerUid, (visibility) => {
      if (active) setSnapshot({ ownerUid, visibility, failed: false });
    }, fail).then((unsubscribe) => { if (active) stop = unsubscribe; else unsubscribe(); }).catch(fail);
    return () => { active = false; stop?.(); };
  }, [ownerUid]);
  const current = snapshot?.ownerUid === ownerUid ? snapshot : undefined;
  return { visibility: current?.visibility ?? emptyVisibility, failed: current?.failed ?? false };
}
