import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import crypto from "crypto";
import bcrypt from "bcrypt";
import database from "../database/db.js";

const randomPassword = async () => {
  const random = crypto.randomBytes(16).toString("hex");
  return bcrypt.hash(random, 10);
};

const upsertOAuthUser = async ({ provider, profile }) => {
  const email =
    profile.emails?.[0]?.value || `${provider}_${profile.id}@oauth.local`;
  const name = profile.displayName || `${provider} user`;
  const avatarUrl = profile.photos?.[0]?.value || null;

  const existing = await database.query(`SELECT * FROM users WHERE email = $1`, [
    email,
  ]);

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const hashedPassword = await randomPassword();
  const avatar = avatarUrl ? { public_id: null, url: avatarUrl } : null;

  const inserted = await database.query(
    `INSERT INTO users (name, email, password, avatar) VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, email, hashedPassword, avatar]
  );

  return inserted.rows[0];
};

export const initPassport = () => {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${process.env.BACKEND_URL || "http://localhost:4000"}/api/v1/auth/google/callback`,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const user = await upsertOAuthUser({ provider: "google", profile });
            return done(null, user);
          } catch (error) {
            return done(error, null);
          }
        }
      )
    );
  }

  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(
      new FacebookStrategy(
        {
          clientID: process.env.FACEBOOK_APP_ID,
          clientSecret: process.env.FACEBOOK_APP_SECRET,
          callbackURL: `${process.env.BACKEND_URL || "http://localhost:4000"}/api/v1/auth/facebook/callback`,
          profileFields: ["id", "displayName", "emails", "photos"],
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const user = await upsertOAuthUser({
              provider: "facebook",
              profile,
            });
            return done(null, user);
          } catch (error) {
            return done(error, null);
          }
        }
      )
    );
  }
};

