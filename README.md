# Modern Steam OpenID strategy for Passport

A modern [Passport](https://github.com/jaredhanson/passport) strategy for authenticating
with [Steam](http://steamcommunity.com/) using OpenID 2.0. Inspired by the original [passport-steam](https://github.com/liamcurry/passport-steam/) strategy, and DoctorMcKay's [node-steam-signin](https://github.com/DoctorMcKay/node-steam-signin) library.

There is currently a vulnerability in the original [passport-steam](https://github.com/liamcurry/passport-steam/) library that allows you to authenticate as any steam account.

## Installation

```bash
$ npm install --save @dessly/passport-steam
```

## Contents

- [Options](#options)
- [Usage](#usage)
- [Examples](#examples)

## Options

This strategy takes an options object with the following properties:

- `returnUrl` - The URL to which Steam will redirect the user after authentication. This should be the URL of the route that calls `passport.authenticate('steam')`.
- `realm` - The URL to which Steam will redirect the user after authentication. This should be the root URL of your website.
- `fetchSteamLevel` - Whether or not to fetch the user's Steam level. Defaults to `false`. Requires an API key to be provided.
- `fetchUserProfile` - Whether or not to fetch the user's profile. Defaults to `true`. Requires an API key to be provided.
- `proxy` - Optional outbound proxy URL for Steam requests, for example `http://user:pass@127.0.0.1:8080`. Can also be a sync or async function returning a proxy URL, `false`, or `undefined`; the function receives the Express request and is resolved once for the Steam callback request, then reused for validation/profile/level/bans calls. If omitted or the function returns `undefined`, the strategy will also respect `HTTPS_PROXY`, `ALL_PROXY`, `HTTP_PROXY`, and `NO_PROXY`. Set `proxy: false` or return `false` to disable proxy env inheritance.
- `apiKey` - A Steam API key to use for fetching the user's Steam level and profile. Can be a string or a function that returns a string. Can be async if you need to fetch the key from a remote service!
	- If you do not explicity set `fetchUserProfile` to `false`, an error will be thrown if you do not provide an API key.
	- If you do not provide an API key, the first parameter passed to the verify callback will be the SteamID object.
	- If you provide an API key, the first parameter passed to the verify callback will be the full user object. (See examples below)

Example options object:
```js
{
	returnUrl: 'http://localhost:3000/login/return',
	realm: 'http://localhost:3000/',
	fetchSteamLevel: true, // Defaults to false, makes an extra request to fetch the user's Steam level
	fetchUserProfile: true, // Defaults to true if an API key is provided
	proxy: process.env.STEAM_PROXY || undefined, // Optional string or selector function; supports http:// and https:// proxies
	apiKey: () => {
		// You should return your Steam API key here
		// For security, you should use environment variables or a secure key management service
		// Can be a string or a function that returns a string
		// Can be async if you need to fetch the key from a remote service!
		return 'MY_STEAM_API_KEY';
	}
}
```

Dynamic proxy selector:
```js
passport.use(new SteamStrategy({
	returnUrl: 'http://localhost:3000/login/return',
	realm: 'http://localhost:3000/',
	proxy: async (req) => {
		const proxy = await pickSteamProxy(req);
		if (!proxy) {
			throw new Error('No HTTP proxy is available for Steam auth');
		}

		return proxy;
	},
	apiKey: process.env.STEAM_API_KEY
}, (user, done) => done(null, user)));
```

## Usage

#### Require Strategy

```js
const SteamStrategy = require('@dessly/passport-steam');
```

#### Configure Strategy

If you want to fetch the user's Steam level and profile, you will need to provide a Steam API key. You can get one [here](https://steamcommunity.com/dev/apikey).
If you do not pass an api key, the first parameter passed to the verify callback will be the SteamID object, as you can see in the examples below.

With Profile Fetching:
```js
passport.use(new SteamStrategy({
	returnUrl: 'http://localhost:3000/login/return',
	realm: 'http://localhost:3000/',
	fetchSteamLevel: true,
	fetchUserProfile: true,
	proxy: process.env.STEAM_PROXY || undefined,
	apiKey: () => {
		// You should return your Steam API key here
		// For security, you should use environment variables or a secure key management service
		// Can be a string or a function that returns a string
		// Can be async if you need to fetch the key from a remote service!
		return 'MY_STEAM_API_KEY';
	}
}, (user, done) => {
	// Here you would look up the user in your database using the SteamID
	// For this example, we're just passing the full user object back

	done(null, user);
}));
```

Example user object if you pass an API key:
```js
{
  SteamID: SteamID { universe: 1, type: 1, instance: 1, accountid: 893472231 },
  profile: {
    steamid: '76561198853737959',
    communityvisibilitystate: 3,
    profilestate: 1,
    personaname: 'sampli',
    commentpermission: 1,
    profileurl: 'https://steamcommunity.com/id/shamp/',
    avatar: 'https://avatars.steamstatic.com/979e4a6baa364403e1dc268a52034162044ae391.jpg',
    avatarmedium: 'https://avatars.steamstatic.com/979e4a6baa364403e1dc268a52034162044ae391_medium.jpg',
    avatarfull: 'https://avatars.steamstatic.com/979e4a6baa364403e1dc268a52034162044ae391_full.jpg',
    avatarhash: '979e4a6baa364403e1dc268a52034162044ae391',
    lastlogoff: 1716699862,
    personastate: 0,
    primaryclanid: '103582791429521408',
    timecreated: 1534350460,
    personastateflags: 0
  },
  level: 52
}
```

Without Profile Fetching:
```js
passport.use(new SteamStrategy({
	returnUrl: 'http://localhost:3000/login/return',
	realm: 'http://localhost:3000/',
	fetchUserProfile: false // Must explicitly set this to false if you do not want to fetch the user's profile
}, (SteamID, done) => {
	// Here you would look up the user in your database using the SteamID
	// For this example, we're just passing the SteamID64 back as the user id
	const user = {
		id: SteamID.getSteamID64()
	};

	done(null, user);
}));
```

#### Authenticate Requests

Use `passport.authenticate()`, specifying the `'steam'` strategy, to authenticate requests.

For example, as route middleware in an [Express](http://expressjs.com/) application:

```js
app.get('/login', passport.authenticate('steam'));

app.get('/login/return', passport.authenticate('steam', {
	failureRedirect: '/login'
}), (req, res) => {
	// Successful authentication, redirect home.
	res.redirect('/');
});
```

## Examples

There is a basic example using express in the [examples folder](https://github.com/easton36/modern-steam-passport/tree/master/examples/express).

## License

[The MIT License](https://github.com/easton36/modern-steam-passport/blob/master/LICENSE)
