/**
Module dependencies.
*/
import { Strategy as OpenIDStrategy } from '@passport-next/passport-openid';
import SteamWebAPI from 'steamapi';
import { Profile, SteamOpenIDOptions, ValidateCallback } from './strategy.types';
import Express from 'express';

/**
 * Retrieve user's Steam profile information.
 */
function getUserProfile(
    key: string,
    steamID: string,
    callback: (err?: Error | null, profile?: Profile) => void,
) {
    const steam = new SteamWebAPI(key);

    try {
        steam
            .getUserSummary(steamID)
            .then((result) => {
                callback(null, {
                    provider: 'steam',
                    ...result,
                });
            })
            .catch((err) => {
                callback(err);
            });
    } catch (err) {
        callback(err);
    }
}

/**
 * `Strategy` constructor.
 *
 * The Steam authentication strategy authenticates requests by delegating to
 * Steam using the OpenID 2.0 protocol.
 *
 * Applications must supply a `validate` callback which accepts an `identifier`,
 * and optionally a service-specific `profile`, and then calls the `done`
 * callback supplying a `user`, which should be set to `false` if the
 * credentials are not valid.  If an exception occured, `err` should be set.
 *
 * Options:
 *   - `returnURL`  URL to which Steam will redirect the user after authentication
 *   - `realm`      the part of URL-space for which an OpenID authentication request is valid
 *   - `profile`    enable profile exchange, defaults to _true_
 *
 * Examples:
 *
 *     passport.use(new SteamStrategy({
 *         returnURL: 'http://localhost:3000/auth/steam/return',
 *         realm: 'http://localhost:3000/'
 *       },
 *       function(identifier, profile, done) {
 *         User.findByOpenID(identifier, function (err, user) {
 *           done(err, user);
 *         });
 *       }
 *     ));
 *
 */
class Strategy extends OpenIDStrategy {
    public name: string;
    public stateless: boolean;

    constructor(options: SteamOpenIDOptions, validate: ValidateCallback) {
        options.providerURL = options.providerURL || 'https://steamcommunity.com/openid';
        options.stateless = true;

        function verify(
            req: Express.Request,
            identifier: string,
            profile: Profile,
            done: (error: Error | null, user?: Profile, info?: { message: string }) => void,
        ) {
            const validOpEndpoint = 'https://steamcommunity.com/openid/login';
            const identifierRegex = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

            if (
                req.query['openid.op_endpoint'] !== validOpEndpoint ||
                !identifierRegex.test(identifier)
            ) {
                return done(null, undefined, { message: 'Claimed identity is invalid.' });
            }

            const steamID = identifierRegex.exec(identifier)[0];

            if (options.profile) {
                getUserProfile(options.apiKey, steamID, function (err: Error, profile: Profile) {
                    if (err) {
                        done(err);
                    } else {
                        validate(req, identifier, profile, done);
                    }
                });
            } else {
                validate(req, identifier, profile, done);
            }
        }

        super(options, verify);

        this.name = 'steam';
        this.stateless = options.stateless;
    }
}

export = Strategy;
