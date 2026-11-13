interface ReadingLink {
  readonly cached: null | string;
  readonly href: null | string;
}

interface ReadingViewLink extends ReadingLink {
  readonly opened: null | string;
}

interface ReadingViewProbe {
  readonly clickAnchor: () => Promise<null | ReadingLink>;
  readonly open: () => Promise<void>;
  readonly readOpened: () => Promise<null | string>;
}

const POLL_MS = 200;
const MAX_POLLS = 50;
const MAX_OPENS = 2;
const SNAPSHOT_POLLS = 20;
const STABLE_POLLS = 3;

/**
 * Waits for the linker's anchor before clicking once, then polls for navigation. An absent render is a capture error;
 * an anchor whose click opens nothing is a measured result. Every app call stays short; the waits run in Node.
 */
export async function readReadingViewLink(linkerPath: string, probe: ReadingViewProbe): Promise<ReadingViewLink> {
  let anchor: null | ReadingLink = null;
  // A starved renderer can leave Reading view unrendered past the polls, so the note is opened again once.
  for (let open = 0; anchor === null && open < MAX_OPENS; open++) {
    await probe.open();
    for (let poll = 0; anchor === null && poll < MAX_POLLS; poll++) {
      await pause();
      anchor = await probe.clickAnchor();
    }
  }
  if (anchor === null) {
    throw new Error(`Reading-view anchor did not render: ${linkerPath}`);
  }
  if (anchor.href === null) {
    throw new Error(`Reading-view anchor has no data-href: ${linkerPath}`);
  }
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    await pause();
    const opened = await probe.readOpened();
    if (opened !== null) {
      return { ...anchor, opened };
    }
  }
  return { ...anchor, opened: null };
}

/**
 * Reads through a four-second window, accepting failures and empty lists as results too. Early agreement cannot end
 * the window: a stale resolved link or an initial set of suggestions can precede the asynchronous update.
 */
export async function readSettledSnapshot<T>(label: string, read: () => Promise<T>): Promise<T> {
  let previous: string | undefined;
  let stable = 0;
  for (let poll = 0; poll < SNAPSHOT_POLLS; poll++) {
    await pause();
    const snapshot = await read();
    const key = JSON.stringify(snapshot);
    stable = key === previous ? stable + 1 : 1;
    previous = key;
    if (poll === SNAPSHOT_POLLS - 1 && stable >= STABLE_POLLS) {
      return snapshot;
    }
  }
  throw new Error(`Capture did not settle: ${label}`);
}

async function pause(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, POLL_MS);
  });
}
