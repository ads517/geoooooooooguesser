// Settings for Geoooooooooguesser. The README explains where each value comes from.
window.GAME_CONFIG = {
  // Your Google Maps API key (README step 2).
  googleMapsApiKey: "",

  // The most Street View rounds the game will start in one month, counting every player.
  // Google's free allowance is 5,000 a month. If you change this, change the same number
  // in firestore.rules too.
  streetViewMonthlyLimit: 4500,

  // Firebase settings for the shared monthly counter (README step 3).
  // Paste the values from Firebase's "firebaseConfig" here.
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: "",
  },
};
