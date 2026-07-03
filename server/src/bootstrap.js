// First-boot seeding. Creates a default publisher owner + key and the default channels we
// "own", then auto-subscribes the local consumer so the feed isn't empty on first run. The
// reference pushers (clients/) use the returned key to push real content over the public API.
import { db } from "./store.js";
import * as bus from "./bus.js";

export const LOCAL_USER = "local";
const OWNER_ID = "owner_default";

// The channels we ship pushers for. They're just regular channels owned by us.
export const DEFAULT_CHANNELS = [
  { id: "wikipedia", title: "Wikipedia", accent: "#3a86ff", kind: "article", visibility: "public", description: "A random article to skim." },
  { id: "hackernews", title: "Hacker News", accent: "#ff8c42", kind: "discussion", visibility: "public", description: "Top stories." },
  { id: "rss", title: "RSS", accent: "#3a86ff", kind: "article", visibility: "public", description: "Articles from configured feeds." },
  { id: "personal", title: "Personal", accent: "#7c6cff", kind: "note", visibility: "private", description: "Your private lane — calendar, mail, reminders (mock for now)." },
];

export function bootstrap() {
  bus.ensureOwner(OWNER_ID, "whileaway defaults");

  // Publisher key: prefer env (stable across restarts, usable by external pushers); else mint
  // one for this process so in-process pushers work out of the box.
  // The boot key's consumer identity is LOCAL_USER (what the self-host feed is seeded under),
  // while it PUSHES as OWNER_ID — a legitimately distinct (userId, ownerId) pair. This keeps
  // self-host byte-identical: pasting the boot key into the extension still shows the `local`
  // feed, and the one key both pulls that feed and pushes to the default lanes.
  let key = process.env.WHILEAWAY_KEY;
  if (key) {
    if (!bus.ownerForKey(key)) bus.registerKey(key, OWNER_ID, "env key", { userId: LOCAL_USER });
    else bus.setKeyIdentity(key, { userId: LOCAL_USER }); // upgrade a pre-T-10 record in place
  } else {
    key = bus.mintKey(OWNER_ID, "auto (set WHILEAWAY_KEY to persist)", { userId: LOCAL_USER });
  }

  for (const spec of DEFAULT_CHANNELS) {
    bus.createChannel(spec, OWNER_ID);
    // Seed the local consumer (force: includes the private `personal` lane, which the public
    // subscribe route would reject). Real per-user clients get their own set via ensureUser().
    if (!(db.subs[LOCAL_USER] && db.subs[LOCAL_USER][spec.id])) bus.subscribe(LOCAL_USER, spec.id, { force: true });
  }
  return { ownerId: OWNER_ID, key };
}
