# AutoMailer

Upload a JSON array of email addresses, write a subject and body, and AutoMailer sends each recipient a **separate, individual email** — never CC, never BCC, never a shared recipient list.

- **Sequential sends** with a 2-second delay between each (Gmail SMTP rate-limit safety).
- **Failures don't stop the loop** — each recipient's outcome is reported independently.
- **Live progress** via Server-Sent Events: watch each row flip from `queued` to `sent` / `failed` / `skipped` in real time.
- **Validation everywhere** — invalid emails, duplicate addresses, malformed JSON, and quota overflow are all caught and reported.
- **Quota protection** — 50 successful sends per rolling 24-hour window, persisted across restarts.
- **Monochrome UI** with a cursor-distorted grid background.

---

## Requirements

- **Node.js 20 LTS or newer** — [nodejs.org](https://nodejs.org)
- A **Gmail account** with **2-Step Verification enabled** (required for App Passwords)

---

## 1. Get a Gmail App Password

You **cannot** use your normal Gmail password. Gmail requires an "App Password" for SMTP clients like Nodemailer.

### Step-by-step

1. **Enable 2-Step Verification first.** App Passwords only exist if 2FA is on.
   1. Go to <https://myaccount.google.com/security>
   2. Under "How you sign in to Google", click **2-Step Verification**.
   3. Follow the prompts (phone number, SMS or authenticator app).
   4. Confirm it shows **"2-Step Verification is on"**.

2. **Generate the App Password.**
   1. Go to <https://myaccount.google.com/apppasswords> (you must be signed in).
   2. In the **App name** field, type something memorable like `AutoMailer`.
   3. Click **Create**.
   4. Google displays a **16-character password** in a yellow box, e.g. `abcd efgh ijkl mnop`.
   5. **Copy it now** — Google will never show it again. The spaces are cosmetic; you can paste it with or without them, but the code strips spaces, so paste it however it comes.
   6. Click **Done**.

3. **If you don't see the App Passwords page:**
   - 2-Step Verification isn't enabled yet (step 1 above), **or**
   - Your Google account is a **Workspace** account and the admin disabled App Passwords. In that case, use a personal Gmail account, or ask your admin to allow "Less secure apps / App Passwords".

4. **If you see "The setting you are looking for is not available for your account":**
   - Same cause — 2FA off, or Workspace admin policy. Personal accounts with 2FA on always have access.

---

## 2. Set up the project

```bash
# Clone or download the project
cd AutoMailer

# Install dependencies
npm install

# Copy the env template
cp .env.example .env