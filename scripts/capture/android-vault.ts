/**
 * @file
 *
 * An Obsidian vault on an Android device or emulator, driven for an oracle: the vault is a folder of the app's own
 * storage, `/sdcard/Android/data/md.obsidian/files/<vault>`, which Obsidian lists as an app storage vault; files are
 * written there and read back over `adb shell`, never through the app, and calls into the app go over the Chrome DevTools
 * Protocol of its WebView, forwarded by `adb`.
 *
 * The vault is in the app's storage, not in shared storage (`/sdcard/Documents`), because shared storage refuses the
 * characters Windows refuses in a file name, `| : * ? " < > \`, so a file named with one of them cannot reach a vault
 * there at all.
 *
 * The device must be booted, with Obsidian installed and started once (`adb shell monkey -p md.obsidian 1`); the
 * connector opens the vault itself, by selecting it the way the app's vault switcher does and reloading.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  join,
  posix
} from 'node:path';

/**
 * The parameters of one call into the app: a callback run in the page with `input` and the app's globals.
 */
export interface EvalInObsidianParams<Input extends object, Result, Globals extends object> {
  readonly callback: (input: Globals & Input) => Promise<Result> | Result;
  readonly input?: Input;
}

/**
 * How to reach the device and which vault to open.
 */
export interface OpenAndroidVaultParams {
  /**
   * The `adb` serial of the device, or `undefined` for the only one attached.
   */
  readonly serial?: string;

  /**
   * The vault's folder name. Any earlier folder of that name is removed first.
   */
  readonly vaultName: string;
}

/**
 * A vault an oracle writes on disk and reads the app's surfaces in, its callbacks given the app's `Globals`.
 */
export interface OracleVault<Globals extends object> {
  /**
   * Runs a callback in the app.
   */
  readonly evalInObsidian: <Input extends object, Result>(params: EvalInObsidianParams<Input, Result, Globals>) => Promise<Result>;

  /**
   * Creates folders of the vault, with their parents.
   */
  readonly mkdir: (paths: readonly string[]) => Promise<void>;

  readonly [Symbol.asyncDispose]: () => Promise<void>;

  /**
   * Reads a file of the vault from disk.
   */
  readonly readText: (path: string) => Promise<string>;

  /**
   * Writes files of the vault on disk, paced, creating their folders.
   */
  readonly writeFiles: (files: ReadonlyMap<string, string>, paths: Iterable<string>) => Promise<void>;
}

interface CdpEvaluateResult {
  readonly exceptionDetails?: CdpExceptionDetails;
  readonly result?: CdpRemoteObject;
}

interface CdpExceptionDetails {
  readonly exception?: CdpRemoteObject;
  readonly text: string;
}

interface CdpMessage {
  readonly id?: number;
  readonly result?: CdpEvaluateResult;
}

interface CdpRemoteObject {
  readonly description?: string;
  readonly value?: unknown;
}

interface CdpTarget {
  readonly type: string;
  readonly webSocketDebuggerUrl: string;
}

const APP_ID = 'md.obsidian';
const APP_STORAGE = `/sdcard/Android/data/${APP_ID}/files`;
const DEVICE_SCRIPT = '/data/local/tmp/oracle-vault-write.sh';
const EVAL_TIMEOUT_MS = 120_000;
const MAX_ADB_OUTPUT_BYTES = 268_435_456;
const POLL_MS = 500;
const OPEN_POLLS = 360;
// The vault watcher drops files written in a burst, as on desktop, so the writes are paced on the device.
const WRITE_PAUSE_S = 0.015;

/**
 * Opens a fresh vault in the app's storage on an Android device.
 *
 * @param params - The device and the vault.
 * @returns The vault.
 */
export async function openAndroidVault<Globals extends object>(params: OpenAndroidVaultParams): Promise<OracleVault<Globals>> {
  const adbArguments = params.serial === undefined ? [] : ['-s', params.serial];
  function adb(...arguments_: string[]): Buffer {
    return execFileSync(adbPath(), [...adbArguments, ...arguments_], { maxBuffer: MAX_ADB_OUTPUT_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  function shell(command: string): string {
    return adb('shell', command).toString();
  }

  const pid = shell(`pidof ${APP_ID}`).trim();
  if (pid === '') {
    throw new Error(`${APP_ID} is not running: start it once with \`adb shell monkey -p ${APP_ID} 1\``);
  }
  const basePath = `${APP_STORAGE}/${params.vaultName}`;
  shell(`rm -rf ${quote(basePath)} && mkdir -p ${quote(`${basePath}/.obsidian`)}`);
  const port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`).toString().trim();
  const hostDirectory = mkdtempSync(join(tmpdir(), 'oracle-vault-'));

  async function evaluate(expression: string): Promise<unknown> {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json() as CdpTarget[];
    const target = targets.find(({ type }) => type === 'page');
    if (target === undefined) {
      throw new Error('The app\'s WebView has no page');
    }
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    try {
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve);
        socket.addEventListener('error', reject);
      });
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { awaitPromise: true, expression, returnByValue: true } }));
      const message = await new Promise<CdpMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`No answer from the app in ${String(EVAL_TIMEOUT_MS)} ms`));
        }, EVAL_TIMEOUT_MS);
        socket.addEventListener('message', ($event: MessageEvent<string>) => {
          const parsed = JSON.parse($event.data) as CdpMessage;
          if (parsed.id !== 1) {
            return;
          }

          clearTimeout(timer);
          resolve(parsed);
        });
      });
      const details = message.result?.exceptionDetails;
      if (details !== undefined) {
        throw new Error(details.exception?.description ?? details.text);
      }
      return message.result?.result?.value;
    } finally {
      socket.close();
    }
  }

  async function evalInObsidian<Input extends object, Result>({ callback, input }: EvalInObsidianParams<Input, Result, Globals>): Promise<Result> {
    const source = callback.toString();
    return await evaluate(`(async () => await (${source})(Object.assign(${String(JSON.stringify(input ?? {}))},{ app: globalThis.app })))()`) as Result;
  }

  function writeOnDevice(script: string): void {
    const hostScript = join(hostDirectory, 'write.sh');
    writeFileSync(hostScript, script);
    adb('push', hostScript, DEVICE_SCRIPT);
    shell(`sh ${DEVICE_SCRIPT}`);
  }

  // Selects the vault the way the vault switcher does, and reloads the page into it.
  await evaluate(`(async () => {
    await globalThis.Capacitor?.Plugins?.Preferences?.set({ key: 'mobile-selected-vault', value: ${JSON.stringify(params.vaultName)} });
    localStorage.setItem('mobile-selected-vault', ${JSON.stringify(params.vaultName)});
    localStorage.setItem('enable-plugin-' + ${JSON.stringify(params.vaultName)}, 'true');
    setTimeout(() => { location.reload(); }, 100);
  })()`);
  let isOpen = false;
  for (let poll = 0; !isOpen && poll < OPEN_POLLS; poll++) {
    await new Promise((resolve) => {
      setTimeout(resolve, POLL_MS);
    });
    try {
      isOpen = await evaluate(`globalThis.app?.vault?.getName() === ${JSON.stringify(params.vaultName)} && globalThis.app.workspace.layoutReady === true`) === true;
    } catch {
      // The page is reloading.
    }
  }
  if (!isOpen) {
    throw new Error(`The app did not open the vault ${params.vaultName}`);
  }

  return {
    evalInObsidian,
    mkdir: async (paths): Promise<void> => {
      writeOnDevice(paths.map((path) => `mkdir -p ${quote(`${basePath}/${path}`)}\n`).join(''));
      await Promise.resolve();
    },
    readText: async (path): Promise<string> => {
      await Promise.resolve();
      return adb('exec-out', `cat ${quote(`${basePath}/${path}`)}`).toString('utf-8');
    },
    [Symbol.asyncDispose]: async (): Promise<void> => {
      adb('forward', '--remove', `tcp:${port}`);
      rmSync(hostDirectory, { force: true, recursive: true });
      await Promise.resolve();
    },
    writeFiles: async (files, paths): Promise<void> => {
      let script = '';
      for (const path of paths) {
        const full = `${basePath}/${path}`;
        const content = Buffer.from(files.get(path) ?? '', 'utf-8').toString('base64');
        script += `mkdir -p ${quote(posix.dirname(full))}\nprintf '%s' '${content}' | base64 -d > ${quote(full)}\nsleep ${String(WRITE_PAUSE_S)}\n`;
      }
      writeOnDevice(script);
      await Promise.resolve();
    }
  };
}

// The adb of the Android SDK, or the one on the PATH.
function adbPath(): string {
  const sdk = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'] ?? (process.env['LOCALAPPDATA'] === undefined ? undefined : join(process.env['LOCALAPPDATA'], 'Android', 'Sdk'));
  const path = sdk === undefined ? undefined : join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  return path !== undefined && existsSync(path) ? path : 'adb';
}

// A path quoted for the device's shell.
function quote(path: string): string {
  return `'${path.replaceAll('\'', String.raw`'\''`)}'`;
}
