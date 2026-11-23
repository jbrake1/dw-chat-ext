# Install DW Chat Integration

These steps are for the packaged zip (version 0.1.0). Chrome is the supported browser (version 120 or later). The extension is not in the Chrome Web Store yet, so you load it yourself.

**Download:** [dw-chat-ext-v0.1.0.zip](https://dwalliance.com/editor-ai/dw-chat-ext-v0.1.0.zip) from the [AI/SI Editor](https://dwalliance.com/editor-ai/index.html) page, or from the [v0.1.0 GitHub release](https://github.com/jbrake1/dw-chat-ext/releases/tag/v0.1.0).

Optional check: the zip’s md5 is `321bfae3f98070bdbdffb8eeb9f5750a`.

## Install in Chrome

1. **Download the zip** and unzip it into its own folder. Put that folder somewhere you will keep, such as Documents — not a temporary place you empty later. Chrome reads the extension from this folder, so do not move or delete it after you install.

2. **Open the unzipped folder.** You should see a file named `manifest.json` right there, next to folders such as `background`, `content`, `icons`, and `popup`. If you only see a single folder, open that folder and look again.

3. In Chrome’s address bar, go to `chrome://extensions`.

4. Turn on **Developer mode**. The switch is usually in the top right.

5. Click **Load unpacked** and choose the folder that contains `manifest.json`.

6. Pin it for easy access: click the puzzle-piece **Extensions** icon on the Chrome toolbar, find **DW Chat Integration**, and click the pin.

You may see a Chrome warning that this extension is in developer mode. That is normal for an extension you load this way.

## Pair ChatGPT, then use it on your site

1. Open [chatgpt.com](https://chatgpt.com) in a tab and sign in.

2. While that ChatGPT tab is in front, click the **DW Chat Integration** icon and click **Pair this tab**. The popup should say **Paired with:** followed by the tab title, and an **AI** badge appears on the icon for that tab. If **Pair this tab** is unavailable, the popup hint is: “To pair: open chatgpt.com in a tab, sign in, then click this icon there.”

3. Open your DW Alliance site and sign in as an editor.

4. Open **Suggest an edit** on the page (or add `#suggest-edit` to the end of the page address).

5. If the popup says “This site is not on the built-in list. Allow DW Chat Integration to run on it?”, click **Enable on** that site’s name and approve Chrome’s permission prompt.

When the extension is active, the toolbar icon turns green and a **ChatGPT relay** panel appears above the editor’s typing area. Circle or point at what you want to change, type your note, and press **Send**. Your screenshot and note go to the paired ChatGPT tab, and the reply streams into the panel. Nothing is sent until you press Send.

In the panel you can use **Stop**, **Pause**, **Resume**, and **Unpair**. There is also a checkbox: **Also send my request to ChatGPT when I press Send**.

Closing the ChatGPT tab, or navigating that tab away from chatgpt.com, unpairs it. You can pair again from the ChatGPT tab at any time. Only one chat tab can be paired at once.

## Update to a new version

1. Download the new zip.

2. Unzip it and replace the files in the **same folder** you loaded before. Leave that folder where it is.

3. Open `chrome://extensions` and click the reload icon on the **DW Chat Integration** card.

You do not need to click **Load unpacked** again unless you moved the folder.

## Remove it

1. Open `chrome://extensions`.

2. On the **DW Chat Integration** card, click **Remove** and confirm.

3. You can then delete the unzipped folder if you no longer need it.

## If something goes wrong

- **“Manifest file is missing” or “Manifest file is missing or unreadable.”** You picked the wrong folder. Choose the folder that itself contains `manifest.json` (you should see that file when you open the folder). If unzipping created an extra nested folder, go one level in.

- **Chrome warns about Developer mode or unpacked extensions.** That is expected until the extension is in the Chrome Web Store.

- **The icon stays grey on your site.** Sign in as an editor, open **Suggest an edit**, and if the popup asks, click **Enable on** that site. The icon stays grey until the site confirms you are a signed-in editor. If Suggest an edit is not enabled on that site yet, the extension will not switch on.

- **The popup says “No chat tab paired,” or the panel says “ChatGPT relay: no tab paired.”** Open chatgpt.com, sign in, click the **DW Chat Integration** icon **on that tab**, and click **Pair this tab**.

- **ChatGPT is not responding, or you see “ChatGPT tab is not signed in” or “could not reach the ChatGPT tab.”** Refresh the ChatGPT tab, sign in again, and re-pair. Closing the tab or leaving chatgpt.com unpairs it automatically.

- **“Not sent: the site did not confirm you are an editor.”** Sign in again as an editor. If the editor is not enabled on that site yet, ask DW to turn it on.

- **The extension stopped working after you moved or deleted the folder.** Put the folder back (or unzip the zip again), then use **Load unpacked** and choose it once more.

## Other Chromium browsers

Chrome is the supported browser. Nothing in the extension is written to block other Chromium browsers. In Microsoft Edge or Brave you can try the same steps from `edge://extensions` or `brave://extensions` (Developer mode, then **Load unpacked**). If anything looks different, use Chrome.

## From a source checkout

If you cloned this repository instead of using the zip, load the `extension/` folder (the one that contains `manifest.json`), not the repository root.
