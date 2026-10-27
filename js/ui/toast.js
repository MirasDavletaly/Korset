// Короткие уведомления поверх карты.
import { $, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';

export function toast(msg, { type = 'info', action = null, timeout = 4200 } = {}) {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstElementChild.remove();
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  t.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'ok' ? 'check' : 'info')}<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) $('button', t).addEventListener('click', () => { action.fn(); t.remove(); });
  box.appendChild(t);
  setTimeout(() => t.remove(), timeout);
}
