# 3sln.me Privacy Policy

Draft for review. Version: 2026-10-21 (draft). Not yet in effect.

<!-- Placeholders: [EU REPRESENTATIVE], [UK REPRESENTATIVE] (pending the Art. 27 decision). Every factual statement below is tied to the as-built system in docs/legal/README.md; update both together. -->

This policy explains what personal data the hosted service at **3sln.me** collects, why, who receives it, how long it is kept, and what you can do about it. It covers only the service we operate at 3sln.me. If you run the open-source Bindle software yourself, or use another Bindle provider, that operator is responsible for your data.

## 1. Who we are

3sln.me is operated by **Stubbs Software Solutions LLC**, doing business as **3sln**, 41 West Highway 14 #1645, Spearfish, SD 57783, United States ("we", "us"). We are the controller of the personal data described here.

Contact for privacy questions and requests: **contact@3sln.com**.

[EU REPRESENTATIVE] · [UK REPRESENTATIVE]

## 2. The short version

- We collect what we need to run your account and keep it secure. Sign-up does not ask for your name.
- We do not sell your data, we do not show ads, and the 3sln.me interface loads no third-party analytics or tracking.
- Your content is **not end-to-end encrypted**. We encrypt some sensitive data, such as storage credentials and private keys, with our own keys. Messages, files and your profile are stored readable by our systems. We access them only to run the service, keep it secure, or comply with the law.
- Your profile is private by default. Contacts and apps see only what you choose to share with them.
- You can ask us for a copy of your data, or ask us to correct or delete it, at contact@3sln.com.

## 3. What we collect

### Account and sign-in

- **Account identifiers.** A random account ID, the account name we assign you (such as `n.2a@3sln.me`), and any short alias you claim with a paid plan.
- **Account records.** When the account was created and last active, which version of the terms you accepted and when, your plan, and a short security log. The log keeps the type and time of up to 100 recent account events. It contains no passwords, tokens, email addresses or IP addresses.
- **Credentials.**
  - If you set a password, we store only a salted Argon2id hash of it.
  - For passkeys, we store the public key and a label. Your device keeps the private key.
- **Recovery file.**
  - Your recovery file is created and encrypted in your browser, using the answers to your recovery questions. We never receive those answers.
  - We keep only a one-way hash of the recovery secret, so we can check it when you use it.
  - The question prompts and any hints you write are stored inside the file without encryption. Don't put sensitive information in a hint.
- **Age and region confirmation.** When you sign up, we record that you confirmed you are over the minimum age for your country (section 10).
- **Contact for account notices.** To activate an account you either confirm an email address or allow browser notifications.
  - A confirmed email address is stored with your account and used for sign-in codes, account and security notices, and, if you turn it on, email sign-in.
  - If you choose notifications, we store your browser's push subscription instead: the endpoint, its keys and a label.

### Content you choose to store

- **Profile.** A display name, bio and avatar link, if you add them. Your profile is not shown to contacts unless you turn on sharing, and then only the fields you allow for each contact.
- **Contacts and contact links.** Who you have connected with, the contact links you create, and their rules.
- **Messages and conversations.** What you send and receive through 3sln.me, with your tags, views, rules and organization.
- **Files and storage.**
  - Files you store with us are kept in our object storage.
  - If you connect your own storage, such as Google Drive or an S3-compatible service, we keep the connection details and credentials, encrypted with our keys. We read and write only the files that connection is authorized for.
- **Settings and preferences**, such as language, notification and search choices.

### Billing

If you buy a paid plan, checkout and payment are handled by **Polar**.
- **What Polar collects.** Your payment details and the email address you give at checkout, under Polar's own privacy policy. We never receive your card details.
- **What we exchange with Polar.** We send Polar your account ID and, at checkout, your IP address so it can assess fraud and tax. We receive your subscription status, plan and payment history.
- **Payment event records.** We keep records of payment events for 35 days.

### Security and abuse prevention

- **IP address and location.** When you use the service, we receive your IP address and the approximate country (and for some countries, state or province) that our hosting provider derives from it.
- **How we use them.** We use this to:
  - enforce rate limits and sign-up limits;
  - apply the age rules for your country;
  - show prices in your local currency.
- **Rate-limit counters.** We do not store raw IP addresses for this. Counters use keyed one-way hashes of your IP address, network range and country, and they expire within 24 hours.
- **Cloudflare Turnstile.** Sign-up, sign-in, recovery and some other actions are protected by Cloudflare Turnstile. It runs in your browser and receives information from your device and browser to tell people from bots. We send Cloudflare the challenge result and your IP address to verify it.

### Optional features

- **Semantic search** (off unless you turn it on). To provide it, we send your search queries and the first part of the text of your messages (roughly the first 480 bytes) to an AI model run by Cloudflare. We store the resulting search vectors.
  - Turning the feature off stops new processing.
  - The model does not use your data for training.
- **Notification previews** (off unless you turn them on). With previews on, a notification can include a message's title and text. The content is encrypted on its way through your browser's push service (Google, Mozilla or Apple, depending on your browser).
- **Connected apps.** When you sign in to another app with 3sln.me, or approve its access, we record that grant, what it covers, and when it was last used.
  - By default an app learns only your account ID.
  - It receives your name, profile, preferences or other resources only if you approve that specifically.
  - Each app's own privacy policy governs what it does with the data.
- **Message classification** (paid plans, when available). This sorts incoming messages, for example to flag likely spam. It sends up to the first 2,000 bytes of a message's text and some header details to an AI model run by Cloudflare.

### Feature rollouts and experiments

- **Gradual rollouts.** We sometimes switch new features on gradually, by region or for a share of accounts.
- **Assignment.** Whether a feature is on for you is computed from your account ID or region. It needs no extra tracking.
- **Experiment results.** When we compare versions of a feature, we record only daily counts per version. To count distinct accounts in a day we use a temporary daily key, deleted when that day's counts are totalled. We show no result for groups smaller than 100 accounts, keep no per-person event log, and delete results 90 days after the experiment ends.

### What we don't collect

- your legal name or date of birth;
- your phone number;
- your contacts from other services;
- your precise location;
- advertising identifiers.

We don't read your browser's user-agent string to identify you.

## 4. Why we use it (legal bases)

| Purpose | Data | Legal basis (EU/UK GDPR) |
|---|---|---|
| Create and run your account; deliver messages, contacts and storage | Account, credentials, content, settings | Performance of our contract with you |
| Sign-in, recovery and security notices | Credentials, email or push subscription | Contract; legitimate interests (account security) |
| Prevent abuse, fraud and spam; rate limiting; Turnstile | IP address, country, pseudonymised counters, Turnstile signals | Legitimate interests (keeping the service safe and available) |
| Applying age rules by country | Region, your age confirmation | Legal obligation; legitimate interests |
| Billing and tax | Account ID, plan status, payment events, checkout IP | Contract; legal obligation |
| Semantic search, notification previews | Queries and message excerpts, notification content | Your consent, which you can withdraw in settings at any time |
| Feature rollouts and aggregate experiment results | Account ID, region, feature assignment | Legitimate interests (improving the service) |
| Complying with law and protecting rights | Any relevant data | Legal obligation; legitimate interests |

Where we rely on legitimate interests, you can object (section 9).

## 5. Who receives your data

We don't sell or rent personal data, and we don't share it for advertising. We share it only as follows:

| Recipient | Purpose | Data |
|---|---|---|
| **Cloudflare, Inc.** (hosting, storage, email sending, Turnstile, AI models, network connectivity) | Runs the service | All service data, as our processor |
| **Polar** (payments) | Checkout, subscriptions, tax | Account ID, checkout IP, plus what you give Polar directly |
| **Push services** (Google, Mozilla, Apple) | Delivering notifications you enabled | Encrypted notification payloads, to the endpoint your browser chose |
| **Google** (only if you connect Google Drive) | Storing files in your Drive | Files you save through that connection |
| **Other storage providers you connect** | Storing files you choose | Files you save through that connection |
| **Apps you authorize** | What you approved | Only what you approved |
| **Contacts and correspondents** | Communication | Messages you send them and the profile fields you share |
| **Authorities or others, when required** | Legal compliance, protecting safety and rights | Only what the request lawfully requires |
| **A successor** in a merger or acquisition | Continuity of the service | Account data, under this policy |

Our processors may use your data only on our instructions.

## 6. Encryption and our access

- **In transit.** Data travels to and from 3sln.me over encrypted connections.
- **At rest.** Our hosting provider encrypts stored data.
- **Our own encryption.** We additionally encrypt connected-storage credentials, private identity keys, contact link secrets and waitlist addresses with our own keys.
- **What isn't end-to-end encrypted.** 3sln.me is not end-to-end encrypted today. Messages, files, profiles and your email address are stored in a form our systems can read.
- **When staff access it.** Authorized staff access account data only when it is needed to operate or support the service, investigate security or abuse, or meet a legal obligation.
- **Moderation tools.** Our admin tools let us look up and suspend accounts. They do not include a feature for browsing message content.

## 7. International transfers

We and our providers process data in multiple countries. Cloudflare runs a global network.
- **EEA, UK or Swiss transfers.** Where personal data from these regions goes to a country without an adequacy decision, we rely on the European Commission's Standard Contractual Clauses (and the UK addendum) or another lawful transfer mechanism.
- **Copies.** You can ask us for a copy of the relevant safeguards.

## 8. How long we keep it

| Data | Retention |
|---|---|
| Account, profile, content and settings | While your account exists, or until you delete it |
| Sign-in sessions | Up to 24 hours each; at most 10 at a time |
| Sign-up, sign-in and confirmation codes and links | 5 to 30 minutes |
| Rate-limit counters | Up to 24 hours |
| Security log | Most recent 100 events |
| Payment event records | 35 days; Polar and our accounting records follow tax law |
| Waitlist email | Until you leave the waitlist, or 180 days after you confirm |
| App authorizations | Until you revoke them; unused authorizations expire after 180 days |
| Spam and rejected messages (when available) | 7 days, after which they are deleted |
| Aggregate experiment results | 90 days after the experiment ends |

**Inactive accounts.** We may delete free accounts that are unused or inactive.
- **Notice first.** Before we do, we will send several notices to your confirmed email or notification channel, with time to sign in and keep the account.
- **Paid accounts.** Accounts that have ever paid are not deleted for inactivity.

**Deleted accounts.** When an account is deleted:
- we remove its credentials, sessions, recovery hash, email address and stored files;
- we keep a minimal record of the account ID, its account names and when it was created, so those names are never reassigned to someone else.

**Data kept in connected storage.** Files you saved to your own storage, such as Google Drive, stay there until you delete them.

**Backups.** Our providers' backup and recovery systems may keep data for a limited time after deletion.

## 9. Your rights

Depending on where you live, you may have the right to:
- access your personal data and get a copy of it;
- correct it;
- delete it;
- restrict or object to its processing;
- receive it in a portable format;
- withdraw consent at any time, without affecting earlier processing.

**In your account.** Many controls are already there:
- revoking sessions, passkeys, apps and storage connections;
- turning off email sign-in, notifications and semantic search;
- deleting items and files.

**By email.** For anything else, including a full export or account deletion, write to **contact@3sln.com** from your account's confirmed email, or send a message through your account.
- We may need to confirm the request comes from you.
- We will respond within one month, which the law lets us extend in some cases.

**Complaints.** You may complain to your local data protection authority. We'd appreciate the chance to resolve your concern first.

**US state privacy rights.**
- Residents of some US states (including California) have rights to know, access, correct and delete personal information, and to opt out of its sale or sharing.
- We don't sell personal information or share it for cross-context behavioural advertising.
- We don't use sensitive personal information to infer characteristics about you.
- We won't discriminate against you for exercising these rights.
- Section 3 lists the categories we collect, and section 5 lists who receives them.

## 10. Age requirements

3sln.me is not intended for children under the minimum age for their country.
- **The age that applies.** This is the age at which a person can use an online service like ours without a parent's consent. It ranges from 13 to 20 depending on the country; where we have not set a specific age, it is 18.
- **At sign-up.** You confirm that you are over that age. Paid plans require you to be an adult where you live.
- **Where we can't offer accounts.** We don't offer sign-up in some countries and regions where local law requires identity or age verification beyond that confirmation.
- **Accounts created underage.** If we learn that an account belongs to someone under the minimum age, we will delete it. If you believe a child has given us personal data, contact us.

## 11. Cookies and storage on your device

**No advertising or analytics cookies.** We use only what the service needs:
- **Sign-in cookies** (`__Host-bindle_session`, `__Host-bindle_account_*`, `__Host-bindle_default_account`, `__Host-bindle_account_cleanup`). These keep you signed in, last up to 24 hours, and are sent only to 3sln.me.
- **Short-lived flow cookies** (`__Host-bindle_setup`, `__Host-bindle_device` and similar, 5 to 30 minutes). These hold your progress through sign-up, device sign-in and sign-in with apps.
- **Local storage.** Your language and keyboard preferences.
- **Session storage.** Progress through sign-up, recovery and checkout. It is cleared when you close the tab.
- **Cached app files.** If you install 3sln.me as an app, your device caches its public files. Your account data is never cached this way.
- **Cloudflare Turnstile.** When a page shows a Turnstile check, it may set or read its own data to protect the service.
- **Apps using 3sln.me sign-in.** Their sites may store a cryptographic key on their own domain to secure your session with them.

Because these are strictly necessary, we don't ask for cookie consent.

## 12. Security

We use strong hashing for passwords, support passkeys, and require a recovery file you hold. We also limit sessions, rate-limit sensitive actions, encrypt sensitive credentials, and keep a security log. No system is perfectly secure.
- **Data breaches.** If a breach affects your personal data, we will notify you and the authorities where the law requires.
- **Reporting a security issue.** Write to contact@3sln.com.

## 13. Changes

- **Updates.** We'll update this policy as the service changes. The version date at the top always shows the current version.
- **Material changes.** For these, we'll notify you in the service or by email before they take effect.

## 14. Contact

Stubbs Software Solutions LLC (3sln), 41 West Highway 14 #1645, Spearfish, SD 57783, United States · contact@3sln.com
