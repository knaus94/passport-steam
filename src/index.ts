import { Strategy as OpenIDStrategy } from '@passport-next/passport-openid';
import SteamAPI, { PlayerSummary } from 'steamapi';
import { Request } from 'express';

export interface Profile extends PlayerSummary {
    provider: string;
}

type ValidateCallback = (
    req: Request,
    identifier: string,
    profile: Profile,
    done: (error: Error | null, user?: Profile, info?: { message: string }) => void,
) => void;

function getUserProfile(
    key: string,
    steamID: string,
    callback: (err?: Error | null, profile?: Profile) => void,
) {
    const steam = new SteamAPI(key);

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

export class Strategy extends OpenIDStrategy {
    public name: string;
    public stateless: boolean;

    constructor(
        options: {
            providerURL?: string;
            stateless?: boolean;
            returnURL: string;
            apiKey: string;
            profile: boolean;
            realm: string;
        },
        validate: ValidateCallback,
    ) {
        options.providerURL = options.providerURL || 'https://steamcommunity.com/openid';
        options.stateless = options.stateless ?? true;

        function verify(
            req: Request,
            identifier: string,
            profile: Profile,
            done: (error: Error | null, user?: Profile, info?: { message: string }) => void,
        ) {
            const validOpEndpoint = 'https://steamcommunity.com/openid/login';
            const identifierRegex = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;
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

        super({ ...options, passReqToCallback: true }, verify);

        this.name = 'steam';
        this.stateless = options.stateless;
    }
}
