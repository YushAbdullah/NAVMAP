# Turn on Community sign-in (Supabase)

About 15 minutes. Until you do this, Community still works, everyone is anonymous and the join screen is skipped.

## 1. Create the Supabase project
1. Go to https://supabase.com and sign in (GitHub or Google is fine).
2. **New project** → name `navmap`, set a database password (save it somewhere), region **Southeast Asia (Singapore)**, Free plan.

## 2. Email + password and forgot password
1. **Authentication → Sign In / Providers → Email**: make sure it is **enabled** and **Confirm email** is on.
2. **Authentication → URL Configuration**:
   - Site URL: `https://navmap.vercel.app`
   - Redirect URLs: add `https://navmap.vercel.app/**`
3. Emails: do section 2b below before real users sign up.

## 2b. Emails (confirm sign-up, forgot password, welcome)
Supabase's own sender only reaches your project team's addresses, so connect Gmail:
1. On muhdyusry.abdullah@gmail.com turn on **2-Step Verification** (myaccount.google.com → Security), then create an **App password** (search "App passwords", name it NAVMAP). Copy the 16-letter password.
2. Supabase → **Authentication → Emails → SMTP Settings** → enable custom SMTP:
   - Sender email: muhdyusry.abdullah@gmail.com · Sender name: NAVMAP
   - Host: `smtp.gmail.com` · Port: `465` · Username: muhdyusry.abdullah@gmail.com · Password: the app password
3. Supabase → **Authentication → Emails → Templates**. For each one, paste the HTML from the repo folder `docs/email-templates/` and set the subject:
   - **Confirm signup** → `confirm-signup.html`, subject `Confirm your NAVMAP email · Sahkan e-mel NAVMAP`
   - **Reset password** → `reset-password.html`, subject `Reset your NAVMAP password · Tetapkan semula kata laluan NAVMAP`
   - **Change email address** → `change-email.html`, subject `Confirm your new NAVMAP email · Sahkan e-mel baharu NAVMAP`
4. Welcome email (sent by NAVMAP itself, once per member after they confirm): in Vercel add
   - `SMTP_USER` = muhdyusry.abdullah@gmail.com
   - `SMTP_PASS` = the same app password
   - optional `MAIL_FROM` = `NAVMAP <muhdyusry.abdullah@gmail.com>`

Gmail allows about 500 emails a day. If NAVMAP grows past that, move to Resend with your own domain (e.g. navmap.my).

## 3. Google sign-in
1. In Supabase, open **Authentication → Sign In / Providers → Google** and copy the **Callback URL** (looks like `https://xxxx.supabase.co/auth/v1/callback`).
2. Go to https://console.cloud.google.com → create a project `NAVMAP`.
3. **APIs & Services → OAuth consent screen**: External, app name NAVMAP, support email muhdyusry.abdullah@gmail.com, add the domain `navmap.vercel.app`, publish the app.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Web application.
   - Authorized JavaScript origins: `https://navmap.vercel.app`
   - Authorized redirect URIs: paste the Supabase Callback URL from step 1.
5. Copy the **Client ID** and **Client secret** into the Supabase Google provider and **enable** it. Save.

## 4. Connect it to NAVMAP
1. In Supabase: **Project Settings → API** (or **API Keys**): copy the **Project URL** and the **anon / public** key. (Not the service_role key.)
2. Vercel → project **navmap** → **Settings → Environment Variables**, add for Production and Preview:
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_ANON_KEY` = the anon key
   - plus `SMTP_USER` / `SMTP_PASS` from step 2b
3. **Deployments → Redeploy** the latest production deployment.

## 5. Check it
- Open https://navmap.vercel.app/api/pins?config=1 — it should show your Supabase URL.
- Alerts → Community: the join screen appears. Try Google, then try Register with email and Forgot password.

Tell me in the thread if any step looks different; Supabase renames menus from time to time.
