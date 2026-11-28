// One sign-in block for every screen: "Continue with Google", email and password, and
// "Forgot password". Customers can also create an account; staff logins are made by the owner.
import { esc } from './store';

type Opts = { formId?: string; create?: boolean; lead?: string };
const G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.200l-6.200-5.200C29.200 35.100 26.700 36 24 36c-5.200 0-9.600-3.300-11.300-7.900l-6.500 5C9.500 39.600 16.200 44 24 44z"/><path fill="#1976D2" d="M43.600 20.100H42V20H24v8h11.300c-.8 2.200-2.200 4.200-4.100 5.600l6.200 5.200C37 39.200 44 34 44 24c0-1.300-.1-2.600-.4-3.900z"/></svg>';

export function signInHtml(o: Opts = {}, mode: 'in' | 'new' = 'in'): string {
  const making = mode === 'new';
  return `<div class="u-si" data-si-box data-si-mode="${mode}">
    ${o.lead ? `<p class="u-hint">${esc(o.lead)}</p>` : ''}
    <button type="button" class="u-btn u-btn--lg u-btn--block u-si__g" data-si="google">${G}Continue with Google</button>
    <p class="u-si__or"><span>or with your email</span></p>
    <form class="u-si__form" data-si-form${o.formId ? ` id="${o.formId}"` : ''} novalidate>
      <input class="u-input" type="email" name="email" autocomplete="username" placeholder="Email" aria-label="Email" required />
      <input class="u-input" type="password" name="password" autocomplete="${making ? 'new-password' : 'current-password'}" placeholder="${making ? 'Choose a password (8 or more characters)' : 'Password'}" aria-label="Password" required />
      <button type="submit" class="u-btn u-btn--primary">${making ? 'Create my account' : 'Sign in'}</button>
    </form>
    <p class="u-si__links">${making ? '<button type="button" class="u-link" data-si="mode">I already have an account</button>' : `<button type="button" class="u-link" data-si="forgot">Forgot password</button>${o.create ? '<button type="button" class="u-link" data-si="mode">New here? Create an account</button>' : ''}`}</p>
    <p class="u-msg" data-si-msg role="alert" hidden></p>
  </div>`;
}

// Makes every sign-in block inside `root` work, now and after the screen redraws it.
export function wireSignIn(root: HTMLElement, o: Opts = {}) {
  const box = (el: Element) => el.closest<HTMLElement>('[data-si-box]');
  const say = (b: HTMLElement | null, t: string) => { const m = b?.querySelector<HTMLElement>('[data-si-msg]'); if (m) { m.textContent = t; m.hidden = !t; } };
  const busy = (b: HTMLElement, on: boolean) => b.querySelectorAll<HTMLButtonElement>('button').forEach((x) => { x.disabled = on; });
  const run = async (b: HTMLElement, job: (api: typeof import('./cloud')) => Promise<string | void>) => {
    busy(b, true);
    say(b, '');
    const api = await import('./cloud');
    try { const done = await job(api); if (b.isConnected) say(b, done ?? ''); }
    catch (e) { if (b.isConnected) say(b, api.authMessage(e)); }
    if (b.isConnected) busy(b, false);
  };
  const email = (b: HTMLElement) => b.querySelector<HTMLInputElement>('input[name=email]')!.value.trim();
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-si]');
    const b = t && box(t);
    if (!t || !b) return;
    if (t.dataset.si === 'google') run(b, (api) => api.googleSignIn());
    else if (t.dataset.si === 'mode') { const typed = email(b); b.outerHTML = signInHtml(o, b.dataset.siMode === 'new' ? 'in' : 'new'); const i = root.querySelector<HTMLInputElement>('[data-si-box] input[name=email]'); if (i) i.value = typed; }
    else if (t.dataset.si === 'forgot') {
      if (!email(b)) return say(b, 'Type your email first, then press Forgot password.');
      // The same answer whether or not the email has an account, so nobody can use this to find out who is a customer.
      run(b, async (api) => {
        try { await api.resetPassword(email(b)); } catch (e) { if (!String((e as { code?: string }).code).includes('user-not-found')) throw e; }
        return 'If that email has an account, a link to set a new password is on its way. Check your junk folder too.';
      });
    }
  });
  root.addEventListener('submit', (e) => {
    const f = e.target as HTMLFormElement;
    if (!f.matches('[data-si-form]')) return;
    e.preventDefault();
    const b = box(f)!;
    const password = f.querySelector<HTMLInputElement>('input[name=password]')!.value;
    if (!email(b) || !password) return say(b, 'Enter your email and password.');
    if (b.dataset.siMode === 'new' && password.length < 8) return say(b, 'Choose a password with at least 8 characters.');
    run(b, (api) => (b.dataset.siMode === 'new' ? api.emailSignUp(email(b), password) : api.emailSignIn(email(b), password)).then(() => undefined));
  });
}
