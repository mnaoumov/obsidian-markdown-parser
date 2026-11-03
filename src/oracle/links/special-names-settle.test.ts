import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  readReadingViewLink,
  readSettledSnapshot
} from '../../../scripts/links/special-names-settle.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('Reading-view capture settling', () => {
  it('waits past the old 500 ms render and click deadlines and clicks only once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const open = vi.fn(async () => {
      await Promise.resolve();
    });
    const click = vi.fn(async () => {
      await Promise.resolve();
      return Date.now() < 1200 ? null : { cached: 'plain', href: 'plain' };
    });
    const readOpened = vi.fn(async () => {
      await Promise.resolve();
      return Date.now() < 2400 ? null : 'plain.md';
    });
    const result = readReadingViewLink('linker.md', { clickAnchor: click, open, readOpened });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ cached: 'plain', href: 'plain', opened: 'plain.md' });
    expect(open).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(6);
    expect(readOpened).toHaveBeenCalledTimes(6);
  });

  it('rejects an absent render instead of recording null results', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const readOpened = vi.fn();
    const result = readReadingViewLink('plain-control.md', {
      clickAnchor: async () => {
        await Promise.resolve();
        return null;
      },
      open: async () => {
        await Promise.resolve();
      },
      readOpened
    });
    const rejected = expect(result).rejects.toThrow('Reading-view anchor did not render: plain-control.md');
    await vi.runAllTimersAsync();
    await rejected;
    expect(readOpened).not.toHaveBeenCalled();
  });

  it('keeps a rendered unresolved link whose click opens nothing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const clickAnchor = vi.fn(async () => {
      await Promise.resolve();
      return { cached: 'missing', href: 'missing' };
    });
    const result = readReadingViewLink('linker.md', {
      clickAnchor,
      open: async () => {
        await Promise.resolve();
      },
      readOpened: async () => {
        await Promise.resolve();
        return null;
      }
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ cached: 'missing', href: 'missing', opened: null });
    expect(clickAnchor).toHaveBeenCalledTimes(1);
  });

  it('rejects a rendered anchor without its target attribute', async () => {
    vi.useFakeTimers();
    const result = readReadingViewLink('broken.md', {
      clickAnchor: async () => {
        await Promise.resolve();
        return { cached: 'plain', href: null };
      },
      open: async () => {
        await Promise.resolve();
      },
      readOpened: async () => {
        await Promise.resolve();
        return null;
      }
    });
    const rejected = expect(result).rejects.toThrow('Reading-view anchor has no data-href: broken.md');
    await vi.runAllTimersAsync();
    await rejected;
  });
});

describe('rename and switcher settling', () => {
  it('does not accept an early resolved value before a delayed unindex', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const result = readSettledSnapshot('rename', async () => {
      await Promise.resolve();
      return { resolved: Date.now() < 1600 };
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ resolved: false });
    expect(Date.now()).toBe(4000);
  });

  it.each([{ offers: [] }, { offers: ['second', 'first'] }])('keeps final offers $offers in their measured order', async ({ offers }) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const result = readSettledSnapshot('switcher', async () => {
      await Promise.resolve();
      return Date.now() < 1600 ? ['first', 'second'] : offers;
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(offers);
  });

  it('refuses a snapshot still changing at the bound', async () => {
    vi.useFakeTimers();
    const result = readSettledSnapshot('switcher', async () => {
      await Promise.resolve();
      return Date.now();
    });
    const rejected = expect(result).rejects.toThrow('Capture did not settle: switcher');
    await vi.runAllTimersAsync();
    await rejected;
  });
});
