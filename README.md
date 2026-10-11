# Lost Postcards

A GeoGuessr-style game. You're dropped on a random Google Street View road somewhere in the world. Look around, walk down the street, then drop a pin on the map where you think you are. Five rounds, up to 5,000 points each.

- **Solo or with friends.** Create a game, share the 4-letter code, and everyone plays the same five places with live scores.
- **Options:** a time limit per round (none, 2 min, 1 min) and "Look only" mode, which turns off walking.
- **Scoring:** 5,000 points for a guess on the spot, about 2,500 at 1,000 km away, close to zero across the world.

## Setup

The game is plain HTML, CSS and JavaScript with no build step. It needs two things:

### 1. Turn on GitHub Pages

1. In this repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick **main** and **/ (root)**, then **Save**.
3. After a minute the game is live at `https://<your-username>.github.io/lost-postcards/`.

### 2. Get a Google Maps API key

Street View comes from Google, so the game needs your own key.

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a project (for example "Lost Postcards").
2. **Billing:** link a billing account to the project. Google asks for a card even though there's a free monthly allowance. Check [Google Maps Platform pricing](https://mapsplatform.google.com/pricing/) for the current free amounts.
3. **APIs & Services → Library:** search for **Maps JavaScript API** and click **Enable**.
4. **APIs & Services → Credentials → Create credentials → API key.** Copy the key.
5. **Lock the key to your site.** Click the key to edit it.
   - Under **Application restrictions**, choose **Websites** and add `https://<your-username>.github.io/*`.
   - Under **API restrictions**, choose **Restrict key** and pick **Maps JavaScript API**.
   - Save.
6. **Cap your spending** so you're never surprised:
   - **Billing → Budgets & alerts:** create a small budget (say $1) with email alerts.
   - **APIs & Services → Maps JavaScript API → Quotas:** lower the daily limits to something like a few hundred.
7. Put the key in the game: open `config.js` on GitHub, click the pencil icon, paste the key between the quotes and commit.

```js
window.LOST_POSTCARDS_CONFIG = {
  googleMapsApiKey: "AIza...your key...",
};
```

Anyone can see this key in the page source. That's normal for Google Maps keys and is why step 5 matters: a restricted key only works on your site.

## Playing with friends

Multiplayer connects players' browsers directly, using the free public [PeerJS](https://peerjs.com/) server to introduce them. No account is needed. Up to 8 players.

- The host taps **Play with Friends → Create Game** and shares the code.
- Friends open the same link, tap **Play with Friends**, type the code and tap **Join**.
- The host taps **Start Game**. Everyone gets the same five places and plays at their own pace. Scores update live, and after each round you can see everyone's pins.
- If the host leaves, the game ends for everyone.

Some strict school or office networks block direct browser-to-browser connections. If joining fails there, try another network.

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout |
| `style.css` | Look and feel, light and dark mode |
| `app.js` | Game logic, Google Maps, multiplayer |
| `locations.js` | Regions the game picks random places from. Add `[latitude, longitude, spread in km]` entries to change where you can land |
| `config.js` | Your Google Maps API key |

To run it on your own computer, serve the folder with any local web server (for example `python3 -m http.server`) and open `http://localhost:8000`. If your key is restricted to your GitHub Pages site, add `http://localhost:8000/*` to its allowed websites too.
