/* Storage layer. Uses Netlify Identity for accounts and the /api endpoints (Netlify Database) for data.
   Falls back to this browser only (guest mode) if the Identity library fails to load. */
(function (root) {
  "use strict";
  const START_BANK = 1000;

  /* ---------- Guest mode: localStorage ---------- */
  function createLocalStore() {
    const KEY = "bj-local-v2";
    const MAX_ROUNDS = 4000;
    let data = null;
    try { data = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
    if (!data) data = { bank: START_BANK, profile: { created_at: new Date().toISOString() }, rounds: [] };
    const write = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {} };

    return {
      mode: "local",
      async getProfile() { return Object.assign({ display_name: "", username: "", hometown: "", bio: "" }, data.profile, { bank: data.bank }); },
      async saveBank(bank) { data.bank = bank; write(); },
      async saveProfile(fields) { Object.assign(data.profile, fields); write(); },
      async addRound(round) {
        data.rounds.push(round);
        if (data.rounds.length > MAX_ROUNDS) data.rounds.shift();
        write();
      },
      async getRounds() { return data.rounds.slice(); }
    };
  }

  /* ---------- Accounts: Netlify Identity + Netlify Database ---------- */
  function createCloudStore(ID) {
    let callbackResult = null;
    let listener = null;
    const ready = ID.handleAuthCallback()
      .then((r) => { callbackResult = r; })
      .catch((e) => { callbackResult = { error: e }; });

    async function api(path, opts) {
      opts = opts || {};
      const res = await fetch("/api/" + path, {
        method: opts.method || "GET",
        headers: opts.body ? { "Content-Type": "application/json" } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        credentials: "same-origin"
      });
      if (!res.ok) {
        const err = new Error("Request failed (" + res.status + ")");
        if (res.status === 409) err.code = "username_taken";
        throw err;
      }
      return res.status === 204 ? null : res.json();
    }

    return {
      mode: "cloud",
      googleEnabled: true,

      onAuth(cb) {
        listener = cb;
        ID.onAuthChange((event, user) => {
          if (event === ID.AUTH_EVENTS.LOGOUT) cb("SIGNED_OUT", null);
          else if (event === ID.AUTH_EVENTS.RECOVERY) cb("PASSWORD_RECOVERY", user ? { user } : null);
          else if (event === ID.AUTH_EVENTS.LOGIN && user) cb("SIGNED_IN", { user });
        });
      },
      async getSession() {
        await ready;
        if (callbackResult && callbackResult.type === "recovery" && listener) {
          const r = callbackResult; callbackResult = null;
          listener("PASSWORD_RECOVERY", r.user ? { user: r.user } : null);
        }
        const user = await ID.getUser();
        return user ? { user } : null;
      },
      callbackError() { return callbackResult && callbackResult.error; },
      async signIn(email, password) { await ID.login(email, password); },
      async signUp(email, password) {
        const user = await ID.signup(email, password);
        return { needsConfirmation: !user.emailVerified };
      },
      async signInWithGoogle() {
        let settings = null;
        try { settings = await ID.getSettings(); } catch (_) {}
        if (settings && settings.providers && settings.providers.google === false) {
          throw new Error("Google sign-in isn't turned on for this site yet. Use email and password for now.");
        }
        ID.oauthLogin("google");
      },
      async resetPassword(email) { await ID.requestPasswordRecovery(email); },
      async updatePassword(password) { await ID.updateUser({ password }); },
      async signOut() { await ID.logout(); },

      getProfile() { return api("profile"); },
      saveBank(bank) { return api("profile", { method: "PATCH", body: { bank } }); },
      saveProfile(fields) { return api("profile", { method: "PATCH", body: fields }); },
      addRound(round) { return api("rounds", { method: "POST", body: round }); },
      getRounds() { return api("rounds"); }
    };
  }

  function createStore() {
    if (root.NFID) return createCloudStore(root.NFID);
    const local = createLocalStore();
    local.notice = "The sign-in library didn't load (check your connection or ad blocker), so this session is saved in this browser only.";
    return local;
  }

  root.BJ = Object.assign(root.BJ || {}, { createStore, START_BANK });
})(window);
