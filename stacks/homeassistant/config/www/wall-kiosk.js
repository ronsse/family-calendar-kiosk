// Hide HA's sidebar on the wall dashboard.
//
// On the 1920px panel the sidebar costs ~510px (27% of the screen) and puts Settings and
// the dashboard editor within reach of anyone at the glass. A theme cannot do this --
// `app-drawer-width` is not what sizes the visible sidebar in current HA (verified).
// `frontend: extra_module_url:` is the supported hook and needs no HACS.
//
// HA keeps the state in localStorage as `dockedSidebar`; "always_hidden" is what
// long-pressing the HA title does. Setting it from a module is what makes it survive a
// Chromium profile wipe, which a manual long-press would not.
//
// DO NOT RELOAD DURING LOGIN. trusted_networks lands on
// /wall-display/today?auth_callback=1&code=<single-use>, and reloading anywhere near that
// races HA persisting its tokens -- the frontend then hangs forever on "Unable to connect
// to Home Assistant". This bit twice: first by reloading immediately, then by reloading
// once the query string cleared, which is still too early. So: never reload in a session
// that began with auth params. The value is stored regardless, and every later load --
// the next watchdog restart, reboot, or kiosk restart -- picks it up. One session with a
// visible sidebar is a cosmetic cost; a wall stuck on "Unable to connect" is a product
// failure.
(function () {
  "use strict";
  var WALL = "/wall-display";
  var WANT = '"always_hidden"';
  var SAW_AUTH = /[?&](auth_callback|code|state)=/.test(window.location.search);

  if (window.location.pathname.indexOf(WALL) !== 0) return;

  try {
    if (window.localStorage.getItem("dockedSidebar") === WANT) return;
    window.localStorage.setItem("dockedSidebar", WANT);
    if (!SAW_AUTH) window.location.reload();
  } catch (e) {
    // localStorage can throw in odd states. A visible sidebar is cosmetic; never let this
    // break the dashboard itself.
  }
})();
