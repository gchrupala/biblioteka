# Biblioteka

A small chat page for brainstorming stories and translating them. It runs entirely in the browser and talks directly to the [Mistral API](https://docs.mistral.ai/). There is no server.

- **Pomysły** (ideas): a writing helper that asks questions and suggests options instead of writing the story itself.
- **Tłumaczenie** (translation): a literary translator into a chosen language (Polish, English, Dutch, Persian, Spanish).

The system prompts are at the top of `app.js`.

## Setup

1. Create a Mistral API key at <https://console.mistral.ai/>. Set a spending limit on the workspace.
2. Optional, for syncing between devices: create a fine-grained GitHub token with access to `gchrupala/app-data` only and the permission *Contents: Read and write*.
3. Open the page. The settings dialog opens on first use. Enter a name (used as the folder in `app-data`), the Mistral key and, optionally, the GitHub token.

Keys are stored in the browser's local storage on that device.

## Data

Conversations are kept in local storage. When a GitHub token is set, they are also synced to `<name>/biblioteka.json` in `gchrupala/app-data`, following the format of the other apps there (`{"biblioteka": 1, "saved", "device", "data"}`). Sync runs on page load, when the page becomes visible again, a few seconds after each reply, and on the *Synchronizuj* button. Conversations from several devices are merged; for the same conversation, the most recently changed version wins.

## Hosting

GitHub Pages serves the page from the root of `main` (*Settings → Pages → Deploy from a branch*) at <https://gchrupala.github.io/biblioteka/>. Every push to `main` redeploys it.

The page also works when `index.html` is opened directly from disk.

## Model

The default model is `mistral-large-latest`. It can be changed in the settings; the field suggests the models available to the key.
