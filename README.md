# Blackjack

Blackjack built on the [Deck of Cards API](https://deckofcardsapi.com/). Six-deck shoe, dealer stands on all 17s, blackjack pays 3:2, with hit, stand, double down and split (up to four hands).

It also has:

- **Accounts.** Sign up and log in with email and password (Google optional). Your bank and every round are saved to your account.
- **Strategy tools.** Optional basic-strategy hints, a Hi-Lo card count, and a "strategy I'm testing" tag on every round.
- **Stats tab.** Bankroll chart, win rate by dealer up card and by starting hand, average result by true count, strategies compared, most common mistakes, recent hands, and CSV/JSON export.
- **Profile tab.** Display name, unique username, hometown, bio and lifetime stats.

It is a static site: no build step, no server code. The backend is [Supabase](https://supabase.com) (free tier).

## Try it without a backend

Open `index.html` as is. While `config.js` has empty keys, the app runs in **guest mode** and saves to the browser only (no login screen).

## Turn on accounts (about 10 minutes)

1. Create a free project at supabase.com.
2. Open **SQL Editor > New query**, paste the contents of `schema.sql`, and click **Run**.
3. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key into `config.js`:
   ```js
   window.BJ_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJ...",
     ENABLE_GOOGLE: false
   };
   ```
   The anon key is designed to be public, so it is fine to commit. The row-level security rules in `schema.sql` make sure each player can only read and write their own data. Never put the `service_role` key in this file.
4. **Easier testing (optional):** under **Authentication > Providers > Email**, turn off "Confirm email" so new accounts can log in immediately. Leave it on if you want email confirmation.
5. After you deploy (below), go to **Authentication > URL Configuration** and set:
   - **Site URL** to your Netlify URL, for example `https://your-site.netlify.app`
   - **Redirect URLs** to include the same URL (and `http://localhost:8888` if you test locally)

   Password-reset and confirmation emails link back to this address.

### Google login (optional)

Create OAuth credentials in Google Cloud Console, add the Supabase callback URL it shows you, enable **Authentication > Providers > Google** in Supabase with your client ID and secret, then set `ENABLE_GOOGLE: true` in `config.js`.

## Put it on GitHub and Netlify

1. Create an empty repository on GitHub.
2. From this folder:
   ```bash
   git init
   git add .
   git commit -m "Blackjack"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
   git push -u origin main
   ```
3. In Netlify: **Add new site > Import an existing project**, pick the repo, leave the build command empty, and set the publish directory to `.` (already in `netlify.toml`). Or drag the folder onto Netlify Drop to deploy manually.
4. Finish step 5 above with your Netlify URL.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | Page layout and styling |
| `app.js` | Game rules, table, sign-in screens, tabs, profile |
| `strategy.js` | Basic strategy tables, Hi-Lo count, hand labels |
| `stats.js` | Stats calculations, charts, CSV/JSON export |
| `store.js` | Saves data to Supabase or, in guest mode, to the browser |
| `config.js` | Your Supabase URL and anon key |
| `schema.sql` | Database tables, security rules and signup trigger |

## Notes

- Basic strategy follows the common chart for six decks, dealer stands on 17, double after split allowed, no surrender.
- The bank is stored by the browser app, so a determined player could edit their own bank through the API. That is fine for a class project or a game among friends, but not for anything involving real money.
