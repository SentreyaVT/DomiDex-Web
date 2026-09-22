// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModalFocus } from '@/components/modal-focus';
afterEach(cleanup);
it('focuses, traps Tab, closes with Escape and restores focus', () => {
  const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
  const close = vi.fn();
  const view = render(<section role="dialog"><ModalFocus onClose={close} /><button>Erste Aktion</button><button>Letzte Aktion</button></section>);
  const first = screen.getByText('Erste Aktion'); const last = screen.getByText('Letzte Aktion');
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(1);
  view.unmount(); expect(document.activeElement).toBe(opener); opener.remove();
});
