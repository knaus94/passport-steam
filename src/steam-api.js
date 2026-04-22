const assert = require("assert");
const { request } = require("./request");

/**
 * Fetches response from a fetch request
 * @param {Response} response - response object
 * @returns {Promise<string|object>} - response data
 */
const returnFetchResponse = async (response) => {
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.indexOf("application/json") !== -1) {
    return await response.json();
  } else {
    const text = await response.text();
    if (text?.includes("Access is denied.")) {
      throw new Error("Steam API key is invalid");
    }
    return text;
  }
};

/**
 * Fetches steam level of user
 * @param {string} steamId - steam id of user
 * @param {string} apiKey - steam api key
 * @param {object} [requestOptions] - transport options
 * @returns {Promise<number>} - steam level
 */
const fetchSteamLevel = async (steamId, apiKey, requestOptions = {}) => {
  const response = await request(
    `https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${apiKey}&steamid=${steamId}`,
    requestOptions
  );
  const data = await returnFetchResponse(response);
  const playerLevel = data?.response?.player_level;
  return playerLevel || 0;
};

/**
 * Fetch steam profile of a user
 * @param {string} steamId - steam id 64 of the user
 * @param {string} apiKey - steam api key
 * @param {object} [requestOptions] - transport options
 * @returns {object} the users steam profile
 */
const fetchSteamProfile = async (steamId, apiKey, requestOptions = {}) => {
  const response = await request(
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`,
    requestOptions
  );
  const data = await returnFetchResponse(response);
  const profile = data?.response?.players?.find(
    (profile) => profile.steamid === steamId
  );
  assert(profile, "There was an error fetching your steam profile.");
  return profile;
};

/**
 * Fetch VAC/community/game bans for a user
 * @param {string} steamId - steam id 64 of the user
 * @param {string} apiKey - steam api key
 * @param {object} [requestOptions] - transport options
 * @returns {Promise<object>} - ban object with VACBanned, NumberOfVACBans, DaysSinceLastBan, NumberOfGameBans, CommunityBanned, EconomyBan
 */
const fetchSteamBans = async (steamId, apiKey, requestOptions = {}) => {
  // // Endpoint: ISteamUser/GetPlayerBans (supports multiple IDs, here we fetch one)
  const response = await request(
    `https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${apiKey}&steamids=${steamId}`,
    requestOptions
  );
  const data = await returnFetchResponse(response);

  const ban =
    data?.players?.find((p) => p.SteamId === steamId) || data?.players?.[0];
  assert(ban, "There was an error fetching your steam bans.");

  return ban;
};

module.exports = {
  fetchSteamLevel,
  fetchSteamProfile,
  fetchSteamBans,
};
