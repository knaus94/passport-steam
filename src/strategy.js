const { Strategy } = require("passport-strategy");
const assert = require("assert");

const { verifyLogin, buildAuthUrl, canonicalizeRealm } = require("./helpers");

const {
  fetchSteamProfile,
  fetchSteamLevel,
  fetchSteamBans,
} = require("./steam-api");

/**
 * `SteamStrategy` is a class that extends `Strategy` for Steam authentication.
 */
class SteamStrategy extends Strategy {
  /**
   * @param {object} options
   * @param {string} options.realm
   * @param {string} options.returnUrl
   * @param {string|Function} options.apiKey
   * @param {boolean} [options.fetchUserProfile=true]
   * @param {boolean} [options.fetchSteamLevel=false]
   * @param {boolean} [options.fetchBans=false]     // // NEW: fetch VAC/community/game bans
   * @param {boolean} [options.passReqToCallback=false]
   * @param {Function} verify
   */
  constructor(options, verify) {
    super();
    this.name = "steam";

    this._verify = verify;
    this._realm = canonicalizeRealm(options.realm);
    this._returnUrl = options.returnUrl;
    this._apiKey = options.apiKey;
    this._fetchUserProfile = options.fetchUserProfile ?? true;
    this._fetchSteamLevel = options.fetchSteamLevel ?? false;
    this._fetchBans = options.fetchBans ?? false; // // NEW
    this._passReqToCallback = options.passReqToCallback ?? false;

    if (!this._realm) {
      throw new Error("OpenID realm is required");
    }
    if (!this._returnUrl) {
      throw new Error("OpenID return URL is required");
    }
    // // API key is required if any Steam Web API calls are enabled
    if (
      (this._fetchUserProfile || this._fetchSteamLevel || this._fetchBans) &&
      !this._apiKey
    ) {
      throw new Error(
        "Steam API key is required to fetch user data. Set fetchUserProfile to false if you do not want to include a Steam API key"
      );
    }
  }

  /**
   * Get the correct format of the user data based on options
   * @param {object} SteamID - The SteamID object
   * @returns {Promise<object>} The user data
   */
  async fetchUserData(SteamID) {
    const steamId64 = SteamID.getSteamID64();
    if (!this._apiKey) return SteamID;

    const apiKey =
      typeof this._apiKey === "string"
        ? this._apiKey
        : await this._apiKey(SteamID);

    const user = { SteamID };

    // // Run independent calls in parallel to minimize latency
    const tasks = [];
    if (this._fetchUserProfile)
      tasks.push(
        fetchSteamProfile(steamId64, apiKey).then((p) => {
          user.profile = p;
        })
      );
    if (this._fetchSteamLevel)
      tasks.push(
        fetchSteamLevel(steamId64, apiKey).then((l) => {
          user.level = l;
        })
      );
    if (this._fetchBans)
      tasks.push(
        fetchSteamBans(steamId64, apiKey).then((b) => {
          user.bans = b;
        })
      );

    if (tasks.length) await Promise.all(tasks);
    return user;
  }

  /**
   * Authenticate the user
   * @param {object} req - The express request object
   * @returns {Promise<void>}
   */
  async authenticate(req) {
    if (!req.query || !req.query["openid.mode"]) {
      const authUrl = buildAuthUrl(this._realm, this._returnUrl);
      return this.redirect(authUrl);
    }

    try {
      // we only care about the query params, so hostname doesnt matter
      const fullUrl = "https://example.com" + req.url;
      const userSteamId = await verifyLogin(fullUrl, this._realm);
      assert(userSteamId, "Steam validation failed");

      // Fetch the user's profile/level/bans per options
      const user = await this.fetchUserData(userSteamId);

      if (this._passReqToCallback) {
        this._verify(req, user, (err, userOut) => {
          if (err) {
            return this.error(err);
          }
          return this.success(userOut);
        });
      } else {
        this._verify(user, (err, userOut) => {
          if (err) {
            return this.error(err);
          }
          return this.success(userOut);
        });
      }
    } catch (err) {
      return this.fail(err);
    }
  }
}

module.exports = SteamStrategy;
