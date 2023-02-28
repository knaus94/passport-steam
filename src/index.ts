import { Strategy as OpenIDStrategy } from '@passport-next/passport-openid';
import SteamWebAPI from 'steamapi';
import { Request } from 'express';

export interface Profile {
    provider: string;
}

type ValidateCallback = (
    req: Request,
    identifier: string,
    profile: Profile,
    done: (error: Error | null, user?: Profile, info?: { message: string }) => void,
) => void;

interface SteamOpenIDOptions {
    providerURL: string;
    stateless?: boolean;
    apiKey: string;
    profile: boolean;
}

function getUserProfile(
    key: string,
    steamID: string,
    callback: (err?: Error | null, profile?: Profile) => void,
) {
    const steam = new SteamWebAPI(key);

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
}

export default class Strategy extends OpenIDStrategy {
    public name: string;
    public stateless: boolean;

    constructor(options: SteamOpenIDOptions, validate: ValidateCallback) {
        options.providerURL = options.providerURL || 'https://steamcommunity.com/openid';
        options.stateless = options.stateless ?? true;

        async function verify(
            req,
            identifier: string,
            profile: Profile,
            done: (error: Error | null, user?: Profile, info?: { message: string }) => void,
        ) {
            const validOpEndpoint = 'https://steamcommunity.com/openid/login';
            const identifierRegex = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;
            console.log('--req--');
            console.log(req);
            console.log('--//req--');
            try {
                if (
                    req.query['openid.op_endpoint'] !== validOpEndpoint ||
                    !identifierRegex.test(identifier)
                ) {
                    return done(null, undefined, { message: 'Claimed identity is invalid.' });
                }

                const steamID = identifierRegex.exec(identifier)[1];

                if (options.profile) {
                    getUserProfile(options.apiKey, steamID, (err, profile) => {
                        if (err) {
                            done(err);
                        } else {
                            validate(req, identifier, profile, done);
                        }
                    });
                } else {
                    validate(req, identifier, profile, done);
                }
            } catch (err) {
                done(err);
            }
        }

        super({ ...options, passReqToCallback: false }, verify);

        this.name = 'steam';
        this.stateless = options.stateless;
    }
}
