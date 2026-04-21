/**
 * Per-browser anonymous identity, persisted in localStorage.
 *
 * Two browser windows on the same origin (or one normal + one
 * incognito) get distinct identities, which is what makes the demo's
 * "open two tabs and chat with yourself" flow work without a real
 * login. When collaboration-ai is mounted into hof-os the host owns
 * user identity and this module gets replaced.
 */

const STORAGE_KEY = "collabai.identity";

const ANIMALS = [
  "Bear",
  "Lemon",
  "Otter",
  "Falcon",
  "Panda",
  "Koala",
  "Hedgehog",
  "Lynx",
  "Octopus",
  "Pelican",
  "Quokka",
  "Raccoon",
  "Sloth",
  "Tapir",
  "Unicorn",
  "Vole",
  "Walrus",
  "Yak",
  "Zebra",
  "Axolotl",
  "Badger",
  "Capybara",
  "Dolphin",
  "Elk",
  "Ferret",
  "Gecko",
  "Heron",
  "Iguana",
  "Jackal",
  "Kakapo",
  "Lemming",
  "Manatee",
  "Narwhal",
  "Ocelot",
  "Penguin",
  "Quail",
  "Reindeer",
  "Salamander",
  "Toucan",
  "Urial",
  "Vicuna",
  "Wombat",
  "Xerus",
  "Yabby",
  "Zebu",
  "Bison",
  "Coyote",
  "Dingo",
  "Egret",
  "Fox",
];

export interface AnonymousIdentity {
  user_id: string;
  display_name: string;
}

export function getOrCreateIdentity(): AnonymousIdentity {
  const existing = readStored();
  if (existing) return existing;

  const fresh = generateIdentity();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    // localStorage can throw in private modes / disabled storage; the
    // ephemeral identity is still usable for the duration of the tab.
  }
  return fresh;
}

export function clearIdentity(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readStored(): AnonymousIdentity | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AnonymousIdentity>;
    if (typeof parsed.user_id === "string" && typeof parsed.display_name === "string") {
      return { user_id: parsed.user_id, display_name: parsed.display_name };
    }
    return null;
  } catch {
    return null;
  }
}

function generateIdentity(): AnonymousIdentity {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  const slug = uuid.replace(/-/g, "").slice(0, 8);
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return {
    user_id: `u_anon_${slug}`,
    display_name: `Anonymous ${animal}`,
  };
}
