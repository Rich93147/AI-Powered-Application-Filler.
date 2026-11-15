# ApplicationFiller

A Firefox extension I built to take the pain out of filling out job applications.

You save your info once, pick a role profile (say, software engineering or machine learning), and hit **Fill & continue**. It fills in what it can, clicks through the boring steps, and stops when it needs you. It never presses the final Submit button, and it won't make up facts about you, your experience, or your legal status. That part's always yours.

Everything stays in your browser. No account, no server, no API key.

## What it does

- **Role profiles.** One set of shared info (name, address, eligibility answers) plus as many role profiles as you want, each with its own skills, projects, work history, education, and resume.
- **Figures out what a form is asking.** It can tell a job application from a login or checkout page, and it handles text boxes, dropdowns (including the custom kind), radio buttons, Yes/No bubbles, dates, and file uploads. It also tries to understand the *meaning* of a question, so "Are you a veteran?" and "Have you served in the military?" both use the same saved answer.
- **Asks when it isn't sure.** If it can't answer something confidently, it pauses and asks you in the popup. It tells you what it thinks the question is about, and you can correct it. It remembers your corrections, and you can look at or delete them any time under **Learned information**.
- **Careful with touchy stuff.** "Protected veteran" isn't the same as "veteran", so a saved "Yes" for one won't get answered for the other. Questions about felonies, drug tests, and background checks are never answered automatically. Legal agreements are never ticked for you.
- **Checks its own work.** After filling, it looks at the page again to make sure the right values actually landed. If a required field is still empty, or the site rejected something, it stops instead of pretending everything went fine.
- **Learns your answers.** Answers you confirm get saved per role profile, so you aren't asked the same thing twice.
- **Resumes.** It attaches the saved resume to upload fields. It can also read text out of a text-based PDF to help build a profile (scanned PDFs won't work). **CONFIRM UPLOAD BEFORE SUBMITTING APPLICATION**. There has been a couple cases where a website refused the resume upload. Unsure how to fix, but honestly somewhat rare and a minor bug, so don't expect a fix anytime soon unless I strike gold.
- **Application history.** Keeps track of what you've opened, started, finished, and favorited.
- **Optional local AI.** If you run [Ollama](https://ollama.com/), it can draft written answers and help structure your resume. Drafts always stop for your review.

## Installing it

There's no build step.

1. Download or clone this repo.
2. In Firefox (121 or newer), go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and pick `manifest.json`. (Temporary add-ons disappear when Firefox restarts, so you'll redo this each time.)
4. Click the toolbar icon, open **Update information**, enter your details, and make a profile. Attach a resume if you want it uploaded for you.

## Using it

1. Open a job application.
2. Click the toolbar icon, pick a profile, hit **Fill & continue**.
3. Answer anything it asks about, either in the popup or right on the page, then hit **Continue**.
4. On the last page, look everything over and submit it yourself.

## Privacy

Your profiles, answers, history, and settings live in Firefox's local storage, and resume files in IndexedDB. Nothing goes to any server of mine, because there isn't one. The question-understanding part runs entirely in your browser.

A couple of optional things do talk to the internet: school names you type while editing education go to [ROR](https://ror.org/) for autocomplete, and the extension can look up a national median salary from the Bureau of Labor Statistics when a form asks for one. Neither one gets your profile or resume.

Backups you export are full of personal info, so keep them out of git.

### Setting up Ollama (optional)

1. Install Ollama and run `ollama pull llama3.2:3b`.
2. Make sure it's running on `127.0.0.1:11434` (the default).
3. If it refuses the extension, set `OLLAMA_ORIGINS` to the `moz-extension://...` address Firefox shows for the extension, then restart Ollama.
4. In **Settings & privacy**, enter the model name and hit **Test local AI connection**.

## Rough edges

- Some sites use odd custom dropdowns that the extension can't drive. When that happens it tells you, takes you to the field, and lets you pick the answer yourself.
- It only knows about the common kinds of questions. Anything unfamiliar gets asked rather than guessed.
- You can upload a Word doc as a resume, but it can't read the text out of one.
- Real application sites are messy, so expect some that don't work right yet.

If a site fills in the wrong thing, open the application page, click the toolbar icon, and hit **Copy debug report**. It lists how the extension saw each field, with your personal info blanked out. Give it a quick read before sharing it.

## License

For now all rights are reserved.
