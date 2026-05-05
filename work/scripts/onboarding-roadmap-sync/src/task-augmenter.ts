import type { Block } from "./html-to-blocks.ts";

export type TaskAugmentation = {
  objective: string;
  checklist: string[];
  questions: string[];
};

const FALLBACK: TaskAugmentation = {
  objective:
    "Read the docs carefully, code through the examples, apply what you learned to a real Avada project, and demo to your mentor.",
  checklist: [
    "Read the entire docs page; note down anything unclear",
    "Code through the examples in the docs; push to GitLab on branch dev/<your-name>",
    "Demo your work to your mentor and go through at least one feedback round",
    "Update your code based on feedback and push a follow-up commit",
  ],
  questions: [
    "Which part of the docs was hardest to understand? What did you do to figure it out?",
    "Where can you apply this knowledge in an actual Avada project?",
    "Was anything in the docs unclear or missing? What would you add?",
  ],
};

const MAP: Record<string, TaskAugmentation> = {
  "/training-docs/week-1-warm-up/i01-nodejs_basic/": {
    objective:
      "Get fluent with Node.js basics (const/let, async/await, module system) and write scripts that hit a REST API and read/write files.",
    checklist: [
      "Install Node.js LTS (≥ 20) via nvm; verify `node -v` and `npm -v`",
      "Create a new project with `npm init -y`, write `index.js` that logs Hello world, run with `node index.js`",
      "Write an `async` function that calls GET `https://jsonplaceholder.typicode.com/users/1` (using `axios` or `fetch`) and logs the response",
      "Split the logic into 3 files: `services/user.service.js`, `utils/logger.js`, `index.js` — use ES Modules (`import/export`)",
      "Push the code to GitLab on branch `dev/<your-name>` and share the link with your mentor for review",
    ],
    questions: [
      "When do you reach for `const`, `let`, or `var`? Why does Avada avoid `var` in its codebase?",
      "What's the difference between CommonJS (`require`) and ES Modules (`import`)? Which one does the current Avada codebase use?",
      "Node.js is single-threaded but still handles concurrent requests — how does the event loop make that work?",
    ],
  },

  "/training-docs/week-1-warm-up/i02-nodejs_basic_exercise/": {
    objective:
      "Work through the Node.js basic exercises to build reflexes around async/await, error handling, and data manipulation.",
    checklist: [
      "Complete every exercise in the docs; one file per exercise in the same repo",
      "Add a `README.md` to the exercises repo listing each exercise with a short description of your approach",
      "Test edge cases for every exercise: empty input, wrong type, negative numbers, large arrays",
      "Get your mentor to review the code and address feedback in at least 2 rounds",
      "Use `console.time` to measure performance on exercises with large loops; optimise where it matters",
    ],
    questions: [
      "Which exercise was the hardest? How did you debug when you got stuck?",
      "Did you notice patterns repeating across exercises? Could any of them be refactored into a shared helper?",
      "How do you test your code? Did you write any unit tests for the exercises?",
    ],
  },

  "/training-docs/week-1-warm-up/i03-koajs/": {
    objective:
      "Build a REST API server with Koa + koa-router, understand the middleware chain (onion model), and centralise error handling.",
    checklist: [
      "Install `koa`, `@koa/router`, `koa-bodyparser`; spin up a hello-world server on port 3000",
      "Implement 3 routes: `GET /books` (list), `GET /books/:id` (return 404 when not found), `POST /books` (validate then create)",
      "Write a logger middleware that prints `method url status duration` for every request",
      "Add a top-level error-handling middleware that catches every exception and returns JSON `{success: false, error}` with the right status code",
      "Test with Postman or curl; screenshot the responses and reference them in your commit message",
    ],
    questions: [
      "What's the core difference between Koa and Express? Why did the Avada team pick Koa?",
      "How does Koa's middleware chain work? Why do people call it the 'onion model'?",
      "When should you use `ctx.throw()` vs throwing a regular Error? Which approach is easier to test?",
    ],
  },

  "/training-docs/week-2-reactjs/reactjs_basic/": {
    objective:
      "Build a small React app using hooks (useState, useEffect, useRef, custom hooks); understand the render lifecycle and the rules of hooks.",
    checklist: [
      "Create a project with Vite + React (TypeScript); confirm `npm run dev` starts the dev server",
      "Implement a counter component using `useState` with +/- and reset buttons",
      "Build a todo list: add/delete/toggle done; persist to `localStorage` via `useEffect`",
      "Write a custom hook `useFetch(url)` that returns `{data, loading, error}`; use it to load 10 users from jsonplaceholder",
      "Push the code to GitLab and record a short screen GIF (e.g. with LICEcap); share the link in the commit",
    ],
    questions: [
      "When should you reach for `useState` vs `useReducer`? Give a concrete example from a real Avada project (e.g. checkout flow, complex form).",
      "Why does `useEffect` need a dependency array? What happens if you pass `[]`, omit it entirely, or forget a dep?",
      "When does React re-render? How do you avoid unnecessary re-renders (memo, useMemo, useCallback)?",
    ],
  },

  "/training-docs/week-2-reactjs/reactjs_shopify-polaris/": {
    objective:
      "Get fluent with Polaris components for building Shopify admin UI — staying consistent with Shopify's design system.",
    checklist: [
      "Install `@shopify/polaris` and `@shopify/polaris-icons`; import the CSS the right way in `main.tsx`",
      "Wrap your app in `<AppProvider i18n={en}>`; verify components render with the correct styling",
      "Build a sign-up form with `TextField`, `Select`, `Checkbox`, and `Button`; validate before submit and show inline errors",
      "Build a data table with `IndexTable` or `DataTable`: 10 mock users, sortable column, pagination",
      "Build a 2-column layout (sidebar + content) using `Page > Layout > Layout.Section`, with a `Card` in each section",
    ],
    questions: [
      "Why does Shopify recommend Polaris for merchant-facing apps? What are the concrete benefits?",
      "When is it OK to write custom CSS instead of using a Polaris component? Is there a rule of thumb?",
      "Polaris ships many major versions (v9, v10, v11, v12, …). What are the risks when migrating between majors? Which version is the current Avada app on?",
    ],
  },

  "/training-docs/week-2-reactjs/reactjs_x_alternative/": {
    objective:
      "Understand the trade-offs between React and Preact, and know when swapping to Preact is worth it for storefront-side code.",
    checklist: [
      "Convert one of your earlier React projects to Preact: switch the imports `react` → `preact`, `react-dom` → `preact`",
      "Configure your bundler (Vite) with the `react` → `preact/compat` alias so third-party libraries that still expect React keep working",
      "Measure bundle size before and after with `rollup-plugin-visualizer`; record the numbers in your commit message",
      "Verify hooks (`useState`, `useEffect`, `useRef`) still behave correctly via `preact/hooks`",
      "Note any React APIs missing or behaving differently in Preact (e.g. Suspense, Concurrent Mode)",
    ],
    questions: [
      "Roughly how much smaller is a Preact bundle vs React? On a storefront app, what does that delta actually buy you?",
      "When is Preact NOT a good fit for an Avada project (e.g. an admin embedded app)?",
      "What is `preact/compat`? What's the trade-off when you use it (larger bundle, but full React-library compatibility)?",
    ],
  },

  "/training-docs/week-3-firebase-and-shopify/i01-getting-started-firebase/": {
    objective:
      "Set up a Firebase project, deploy Cloud Functions (HTTP and Firestore triggers), and understand the serverless architecture Avada is built on.",
    checklist: [
      "Create a fresh Firebase project in the console; enable Cloud Functions and Firestore (native mode)",
      "Install `firebase-tools`, log in, and run `firebase init` locally (pick Functions + Firestore)",
      "Deploy an HTTP function returning `{message: 'hello'}`; verify the URL with curl",
      "Write a function that writes a document to a `users` collection and reads it back via `.where('email', '==', x).get()`",
      "Add an `onCreate` trigger on the `orders` collection that logs every new doc; test by adding a doc manually in the console",
      "Set up the Firebase emulator suite locally; run + test offline (without hitting real Firebase)",
    ],
    questions: [
      "What's the difference between Cloud Functions Gen 1 and Gen 2? Which generation is Avada on, and why?",
      "Firestore vs BigQuery — which workloads belong on which in the Avada stack?",
      "What is a cold start, and how does it affect UX? What strategies reduce it (min instances, region pinning, runtime choice)?",
    ],
  },

  "/training-docs/week-3-firebase-and-shopify/i02-getting-started-shopify/": {
    objective:
      "Set up a Shopify Partner account + dev store, scaffold an app with Shopify CLI, and understand the OAuth flow plus Admin API vs Storefront API.",
    checklist: [
      "Create a (free) Shopify Partner account; create a development store",
      "Install Shopify CLI (`npm i -g @shopify/cli @shopify/app`); scaffold a sample app with `shopify app init`",
      "Run the app locally with `shopify app dev`; log into your dev store; install the app via the tunnel",
      "Make one API call: list the 5 most recent products via the Admin GraphQL API",
      "Read `shopify.app.toml`; understand what each entry in `scopes` grants (e.g. `read_products`, `write_orders`)",
      "Test the OAuth flow: uninstall the app → reinstall → verify a new access token is stored",
    ],
    questions: [
      "REST Admin API vs GraphQL Admin API — which does Avada prefer, and when is it OK to fall back to REST?",
      "What is a webhook? Which webhooks does Avada rely on most (orders/create, products/update, app/uninstalled, …)?",
      "What is App Bridge? What role does it play in an embedded app, and what breaks if you remove it?",
    ],
  },

  "/training-docs/week-3-firebase-and-shopify/i03-getting-started-avada/": {
    objective:
      "Use Avada CLI to scaffold and deploy a Shopify app to team conventions; understand the code structure and the CI/CD workflow.",
    checklist: [
      "Install Avada CLI per the docs; verify with `avada --version`",
      "Scaffold a new app with `avada app create <name>`; walk through the generated folder structure",
      "Run the app locally; deploy to staging on Firebase; verify the deployed URL works",
      "Identify the 3 layers in the generated code: API/repositories, business logic/services, presentation (Polaris UI)",
      "Understand how Avada CLI handles env vars, secrets (Secret Manager), and per-environment config (dev/staging/prod)",
      "Read `firebase.json` and `firestore.rules`; understand what config Avada CLI generates and why",
    ],
    questions: [
      "How does Avada CLI differ from Shopify CLI? Why did the team build a separate CLI instead of just using Shopify's?",
      "What's Avada's current deploy workflow (local → staging → prod)? Who approves what at each step?",
      "Are there naming conventions for functions, files, and folders in an Avada-CLI-generated project? Where are they documented?",
    ],
  },

  "/training-docs/week-4-final-exam/final_exam/": {
    objective:
      "Combine everything from weeks 1–3 to build a complete Sales Pop app: Shopify embedded UI + Firestore backend + storefront popup script — deploy and demo end-to-end.",
    checklist: [
      "Read the Sales Pop spec; write a short design doc covering data flow, Firestore schema, and a UI mockup for merchant config",
      "Build the backend: a Cloud Function `onCreate` on the `orders` collection that writes events into a `salesPopEvents` collection",
      "Build the embedded admin UI with Polaris: let merchants configure frequency (3s/5s/10s), position (bottom-left/bottom-right), and design (color, font)",
      "Build the storefront popup: theme app extension or inline JS injection; fetch the latest event via your API and render the popup",
      "Deploy to your dev store; test end-to-end — create a real order and verify the popup appears on the storefront",
      "Write a complete README (architecture, setup, deploy steps); walk your mentor through the architecture in a 15–20 minute presentation",
    ],
    questions: [
      "When several popups want to fire close together (e.g. 3 orders in 5 seconds), how do you handle the conflict?",
      "Performance: how do you make sure the popup script doesn't slow down the storefront? (script size, lazy loading, async fetch, …)",
      "Which edge case turned out hardest to handle? How did you solve it? Are there any cases you still haven't covered?",
    ],
  },
};

export function getAugmentation(url: string): TaskAugmentation {
  try {
    const path = new URL(url).pathname;
    return MAP[path] ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

type RichText = {
  type: "text";
  text: { content: string; link: { url: string } | null };
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: "default";
  };
  plain_text: string;
  href: string | null;
};

const NEUTRAL = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: "default" as const,
};

function rt(content: string, opts: { bold?: boolean; italic?: boolean; link?: string } = {}): RichText {
  const anno = { ...NEUTRAL, bold: opts.bold ?? false, italic: opts.italic ?? false };
  return {
    type: "text",
    text: { content, link: opts.link ? { url: opts.link } : null },
    annotations: anno,
    plain_text: content,
    href: opts.link ?? null,
  };
}

export function buildHeaderCallout(args: { title: string; url: string; objective: string }): Block {
  return {
    type: "callout",
    callout: {
      rich_text: [
        rt("Source doc: ", { bold: true }),
        rt(args.title, { link: args.url }),
        rt("\n\n"),
        rt("🎯 Objective: ", { bold: true }),
        rt(args.objective),
      ],
      icon: { type: "emoji", emoji: "📖" },
      color: "blue_background",
    },
  };
}

export function buildAugmentationBlocks(augmentation: TaskAugmentation): Block[] {
  const blocks: Block[] = [];

  blocks.push({ type: "divider", divider: {} });

  blocks.push({
    type: "heading_2",
    heading_2: {
      rich_text: [rt("✅ Checklist before marking Done")],
      color: "default",
      is_toggleable: false,
    },
  });

  blocks.push({
    type: "paragraph",
    paragraph: {
      rich_text: [
        rt("Tick each item as you finish it. Demo to your mentor and have them verify before flipping ", {
          italic: true,
        }),
        rt("Status = Done", { italic: true, bold: true }),
        rt(".", { italic: true }),
      ],
      color: "gray",
    },
  });

  for (const item of augmentation.checklist) {
    blocks.push({
      type: "to_do",
      to_do: {
        rich_text: [rt(item)],
        checked: false,
        color: "default",
      },
    });
  }

  blocks.push({ type: "divider", divider: {} });

  blocks.push({
    type: "heading_2",
    heading_2: {
      rich_text: [rt("💬 Discussion questions for your mentor")],
      color: "default",
      is_toggleable: false,
    },
  });

  blocks.push({
    type: "paragraph",
    paragraph: {
      rich_text: [
        rt(
          "Answer these after you've read the docs and worked through the checklist. Your mentor grades on depth of understanding, not 'right vs wrong' answers.",
          { italic: true },
        ),
      ],
      color: "gray",
    },
  });

  for (const question of augmentation.questions) {
    blocks.push({
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [rt(question)],
        color: "default",
      },
    });
  }

  return blocks;
}

export function buildMasterIntroBlocks(): Block[] {
  const blocks: Block[] = [];

  blocks.push({
    type: "heading_2",
    heading_2: {
      rich_text: [rt("🎉 Welcome to the X Team")],
      color: "default",
      is_toggleable: false,
    },
  });

  blocks.push({
    type: "paragraph",
    paragraph: {
      rich_text: [
        rt("X Team is part of Avada Group. We build Shopify apps on a "),
        rt("NodeJS / ReactJS / Firebase / Google Cloud", { bold: true }),
        rt(
          " stack. This page is your 4-week onboarding roadmap — designed to get you fluent with the foundations before you join the regular team workflow in Week 5.",
        ),
      ],
      color: "default",
    },
  });

  blocks.push({
    type: "callout",
    callout: {
      rich_text: [
        rt("Most important rule: ", { bold: true }),
        rt("Ask a lot of questions. ", { bold: true }),
        rt(
          "Don't try to figure everything out alone. Stuck for more than 30 minutes? Ping your mentor. Asking is never a bother — it's the fastest way to learn the product and how the team works.",
        ),
      ],
      icon: { type: "emoji", emoji: "💡" },
      color: "yellow_background",
    },
  });

  blocks.push({
    type: "heading_3",
    heading_3: {
      rich_text: [rt("🗺️ The 4-week roadmap")],
      color: "default",
      is_toggleable: false,
    },
  });

  blocks.push({
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [
        rt("Week 1 — Warm-up: ", { bold: true }),
        rt("Node.js fundamentals + exercises, KoaJS framework"),
      ],
      color: "default",
    },
  });

  blocks.push({
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [
        rt("Week 2 — ReactJS: ", { bold: true }),
        rt("React basics, Shopify Polaris, Preact alternative"),
      ],
      color: "default",
    },
  });

  blocks.push({
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [
        rt("Week 3 — Firebase + Shopify: ", { bold: true }),
        rt("Firebase + Cloud Functions, Shopify CLI + Partner setup, Avada CLI"),
      ],
      color: "default",
    },
  });

  blocks.push({
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [
        rt("Week 4 — Final exam: ", { bold: true }),
        rt("Build the Sales Pop app end-to-end (admin UI + backend + storefront popup)"),
      ],
      color: "default",
    },
  });

  blocks.push({
    type: "heading_3",
    heading_3: {
      rich_text: [rt("📚 Team training docs")],
      color: "default",
      is_toggleable: false,
    },
  });

  blocks.push({
    type: "paragraph",
    paragraph: {
      rich_text: [
        rt("All X Team training material lives at "),
        rt("avada-development.web.app", { link: "https://avada-development.web.app", bold: true }),
        rt(". Every task below links to a specific page on that site — read the source link before tackling the checklist."),
      ],
      color: "default",
    },
  });

  blocks.push({
    type: "heading_3",
    heading_3: {
      rich_text: [rt("✅ How to work each task")],
      color: "default",
      is_toggleable: false,
    },
  });

  blocks.push({
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: [
        rt("Open the task and read the 📖 callout at the top — it has the "),
        rt("source doc and objective", { bold: true }),
        rt("."),
      ],
      color: "default",
    },
  });

  blocks.push({
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: [
        rt("Set Status = "),
        rt("In progress", { bold: true }),
        rt(", read the docs, and code through every example."),
      ],
      color: "default",
    },
  });

  blocks.push({
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: [
        rt("Tick off each item in the "),
        rt("Checklist", { bold: true }),
        rt(" as you finish it. Your mentor will verify each one in review."),
      ],
      color: "default",
    },
  });

  blocks.push({
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: [
        rt("Answer the "),
        rt("discussion questions", { bold: true }),
        rt(" with your mentor (1-on-1 or as part of PR review)."),
      ],
      color: "default",
    },
  });

  blocks.push({
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: [
        rt("Set Status = "),
        rt("Done", { bold: true }),
        rt(" and move on to the next task in the week."),
      ],
      color: "default",
    },
  });

  blocks.push({ type: "divider", divider: {} });

  return blocks;
}
