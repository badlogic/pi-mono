# Design Tokens System

## Overview

A minimal design tokens system for terminal UI theming. Uses a two-layer approach:
1. **Primitive tokens** - Raw color values
2. **Semantic tokens** - Purpose-based mappings that reference primitives

## Architecture

### Primitive Tokens (Colors)

These are the raw chalk color functions - the "palette":

```typescript
interface ColorPrimitives {
  // Grays
  gray50: ChalkFunction;   // Lightest gray
  gray100: ChalkFunction;
  gray200: ChalkFunction;
  gray300: ChalkFunction;
  gray400: ChalkFunction;
  gray500: ChalkFunction;  // Mid gray
  gray600: ChalkFunction;
  gray700: ChalkFunction;
  gray800: ChalkFunction;
  gray900: ChalkFunction;  // Darkest gray
  
  // Colors
  blue: ChalkFunction;
  cyan: ChalkFunction;
  green: ChalkFunction;
  yellow: ChalkFunction;
  red: ChalkFunction;
  magenta: ChalkFunction;
  
  // Modifiers
  bold: ChalkFunction;
  dim: ChalkFunction;
  italic: ChalkFunction;
  underline: ChalkFunction;
  strikethrough: ChalkFunction;
  
  // Special
  none: ChalkFunction;  // Pass-through, no styling
}

type ChalkFunction = (str: string) => string;
```

### Semantic Tokens (Design Decisions)

These map primitives to purposes:

```typescript
interface SemanticTokens {
  // Text hierarchy
  text: {
    primary: ChalkFunction;      // Main content text
    secondary: ChalkFunction;    // Supporting text
    tertiary: ChalkFunction;     // De-emphasized text
    disabled: ChalkFunction;     // Inactive/disabled text
  };
  
  // Interactive elements
  interactive: {
    default: ChalkFunction;      // Default interactive elements
    hover: ChalkFunction;        // Hovered/selected state
    active: ChalkFunction;       // Active/current state
  };
  
  // Feedback
  feedback: {
    error: ChalkFunction;
    warning: ChalkFunction;
    success: ChalkFunction;
    info: ChalkFunction;
  };
  
  // Borders & dividers
  border: {
    default: ChalkFunction;
    subtle: ChalkFunction;
    emphasis: ChalkFunction;
  };
  
  // Code
  code: {
    text: ChalkFunction;
    keyword: ChalkFunction;
    string: ChalkFunction;
    comment: ChalkFunction;
    delimiter: ChalkFunction;
  };
  
  // Markdown specific
  markdown: {
    heading: {
      h1: ChalkFunction;
      h2: ChalkFunction;
      h3: ChalkFunction;
    };
    emphasis: {
      bold: ChalkFunction;
      italic: ChalkFunction;
      strikethrough: ChalkFunction;
    };
    link: {
      text: ChalkFunction;
      url: ChalkFunction;
    };
    quote: {
      text: ChalkFunction;
      border: ChalkFunction;
    };
    list: {
      bullet: ChalkFunction;
    };
    code: {
      inline: ChalkFunction;
      inlineDelimiter: ChalkFunction;
      block: ChalkFunction;
      blockDelimiter: ChalkFunction;
    };
  };
  
  // Output streams
  output: {
    stdout: ChalkFunction;
    stderr: ChalkFunction;
    neutral: ChalkFunction;
  };
}
```

### Theme Structure

A theme combines primitives with semantic mappings:

```typescript
interface Theme {
  name: string;
  primitives: ColorPrimitives;
  tokens: SemanticTokens;
}
```

## Built-in Themes

### Dark Theme

```typescript
const darkPrimitives: ColorPrimitives = {
  // Grays - for dark backgrounds, lighter = more prominent
  gray50: chalk.white,
  gray100: (s) => s,                    // No color = terminal default
  gray200: chalk.white,
  gray300: (s) => s,
  gray400: chalk.gray,
  gray500: chalk.gray,
  gray600: chalk.gray,
  gray700: chalk.dim,
  gray800: chalk.dim,
  gray900: chalk.black,
  
  // Colors
  blue: chalk.blue,
  cyan: chalk.cyan,
  green: chalk.green,
  yellow: chalk.yellow,
  red: chalk.red,
  magenta: chalk.magenta,
  
  // Modifiers
  bold: chalk.bold,
  dim: chalk.dim,
  italic: chalk.italic,
  underline: chalk.underline,
  strikethrough: chalk.strikethrough,
  
  // Special
  none: (s) => s,
};

const darkTheme: Theme = {
  name: "dark",
  primitives: darkPrimitives,
  tokens: {
    text: {
      primary: darkPrimitives.gray100,
      secondary: darkPrimitives.gray400,
      tertiary: darkPrimitives.gray700,
      disabled: darkPrimitives.dim,
    },
    
    interactive: {
      default: darkPrimitives.blue,
      hover: darkPrimitives.blue,
      active: (s) => darkPrimitives.bold(darkPrimitives.blue(s)),
    },
    
    feedback: {
      error: darkPrimitives.red,
      warning: darkPrimitives.yellow,
      success: darkPrimitives.green,
      info: darkPrimitives.cyan,
    },
    
    border: {
      default: darkPrimitives.blue,
      subtle: darkPrimitives.gray600,
      emphasis: darkPrimitives.cyan,
    },
    
    code: {
      text: darkPrimitives.green,
      keyword: darkPrimitives.cyan,
      string: darkPrimitives.green,
      comment: darkPrimitives.gray600,
      delimiter: darkPrimitives.gray600,
    },
    
    markdown: {
      heading: {
        h1: (s) => darkPrimitives.underline(darkPrimitives.bold(darkPrimitives.yellow(s))),
        h2: (s) => darkPrimitives.bold(darkPrimitives.yellow(s)),
        h3: darkPrimitives.bold,
      },
      emphasis: {
        bold: darkPrimitives.bold,
        italic: darkPrimitives.italic,
        strikethrough: darkPrimitives.strikethrough,
      },
      link: {
        text: (s) => darkPrimitives.underline(darkPrimitives.blue(s)),
        url: darkPrimitives.gray600,
      },
      quote: {
        text: darkPrimitives.italic,
        border: darkPrimitives.gray600,
      },
      list: {
        bullet: darkPrimitives.cyan,
      },
      code: {
        inline: darkPrimitives.cyan,
        inlineDelimiter: darkPrimitives.gray600,
        block: darkPrimitives.green,
        blockDelimiter: darkPrimitives.gray600,
      },
    },
    
    output: {
      stdout: darkPrimitives.green,
      stderr: darkPrimitives.red,
      neutral: darkPrimitives.gray600,
    },
  },
};
```

### Light Theme

```typescript
const lightPrimitives: ColorPrimitives = {
  // Grays - for light backgrounds, darker = more prominent
  gray50: chalk.black,
  gray100: (s) => s,                    // No color = terminal default
  gray200: chalk.black,
  gray300: (s) => s,
  gray400: chalk.gray,                  // Use actual gray, not dim
  gray500: chalk.gray,
  gray600: chalk.gray,
  gray700: chalk.gray,
  gray800: chalk.gray,
  gray900: chalk.white,
  
  // Colors - use bold variants for better visibility on light bg
  blue: (s) => chalk.bold(chalk.blue(s)),
  cyan: (s) => chalk.bold(chalk.cyan(s)),
  green: (s) => chalk.bold(chalk.green(s)),
  yellow: (s) => chalk.bold(chalk.yellow(s)),
  red: (s) => chalk.bold(chalk.red(s)),
  magenta: (s) => chalk.bold(chalk.magenta(s)),
  
  // Modifiers
  bold: chalk.bold,
  dim: chalk.gray,                      // Don't use chalk.dim on light bg!
  italic: chalk.italic,
  underline: chalk.underline,
  strikethrough: chalk.strikethrough,
  
  // Special
  none: (s) => s,
};

const lightTheme: Theme = {
  name: "light",
  primitives: lightPrimitives,
  tokens: {
    text: {
      primary: lightPrimitives.gray100,
      secondary: lightPrimitives.gray400,
      tertiary: lightPrimitives.gray600,
      disabled: lightPrimitives.dim,
    },
    
    interactive: {
      default: lightPrimitives.blue,
      hover: lightPrimitives.blue,
      active: (s) => lightPrimitives.bold(lightPrimitives.blue(s)),
    },
    
    feedback: {
      error: lightPrimitives.red,
      warning: (s) => chalk.bold(chalk.yellow(s)),  // Yellow needs extra bold
      success: lightPrimitives.green,
      info: lightPrimitives.cyan,
    },
    
    border: {
      default: lightPrimitives.blue,
      subtle: lightPrimitives.gray400,
      emphasis: lightPrimitives.cyan,
    },
    
    code: {
      text: lightPrimitives.green,
      keyword: lightPrimitives.cyan,
      string: lightPrimitives.green,
      comment: lightPrimitives.gray600,
      delimiter: lightPrimitives.gray600,
    },
    
    markdown: {
      heading: {
        h1: (s) => lightPrimitives.underline(lightPrimitives.bold(lightPrimitives.blue(s))),
        h2: (s) => lightPrimitives.bold(lightPrimitives.blue(s)),
        h3: lightPrimitives.bold,
      },
      emphasis: {
        bold: lightPrimitives.bold,
        italic: lightPrimitives.italic,
        strikethrough: lightPrimitives.strikethrough,
      },
      link: {
        text: (s) => lightPrimitives.underline(lightPrimitives.blue(s)),
        url: lightPrimitives.blue,
      },
      quote: {
        text: lightPrimitives.italic,
        border: lightPrimitives.gray600,
      },
      list: {
        bullet: lightPrimitives.blue,
      },
      code: {
        inline: lightPrimitives.blue,
        inlineDelimiter: lightPrimitives.gray600,
        block: lightPrimitives.green,
        blockDelimiter: lightPrimitives.gray600,
      },
    },
    
    output: {
      stdout: lightPrimitives.green,
      stderr: lightPrimitives.red,
      neutral: lightPrimitives.gray600,
    },
  },
};
```

## Usage Examples

### Simple Text Styling

```typescript
const theme = getTheme();

// Before
console.log(chalk.gray("Secondary text"));

// After
console.log(theme.tokens.text.secondary("Secondary text"));
```

### Interactive Elements

```typescript
const theme = getTheme();

// Before
const cursor = chalk.blue("› ");

// After
const cursor = theme.tokens.interactive.default("› ");
```

### Error Messages

```typescript
const theme = getTheme();

// Before
this.contentContainer.addChild(new Text(chalk.red("Error: " + errorMsg)));

// After
this.contentContainer.addChild(new Text(theme.tokens.feedback.error("Error: " + errorMsg)));
```

### Markdown Headings

```typescript
const theme = getTheme();

// Before
lines.push(chalk.bold.yellow(headingText));

// After
lines.push(theme.tokens.markdown.heading.h2(headingText));
```

### Borders

```typescript
const theme = getTheme();

// Before
this.addChild(new Text(chalk.blue("─".repeat(80))));

// After
this.addChild(new Text(theme.tokens.border.default("─".repeat(80))));
```

## User Configuration

### Theme File Format

Themes can be defined in JSON files that users can customize. The system will load themes from:
1. Built-in themes (dark, light) - hardcoded in the app
2. User themes in `~/.pi/agent/themes/` directory

**Example: `~/.pi/agent/themes/my-theme.json`**

```json
{
  "name": "my-theme",
  "extends": "dark",
  "primitives": {
    "blue": "blueBright",
    "cyan": "cyanBright",
    "green": "greenBright"
  },
  "tokens": {
    "text": {
      "primary": "white"
    },
    "interactive": {
      "default": ["bold", "blue"]
    },
    "markdown": {
      "heading": {
        "h1": ["bold", "underline", "magenta"],
        "h2": ["bold", "magenta"]
      }
    }
  }
}
```

### JSON Schema

Themes in JSON can reference:
1. **Chalk color names**: `"red"`, `"blue"`, `"gray"`, `"white"`, `"black"`, etc.
2. **Chalk bright colors**: `"redBright"`, `"blueBright"`, etc.
3. **Chalk modifiers**: `"bold"`, `"dim"`, `"italic"`, `"underline"`, `"strikethrough"`
4. **Combinations**: `["bold", "blue"]` or `["underline", "bold", "cyan"]`
5. **Primitive references**: `"$gray400"` to reference another primitive
6. **None/passthrough**: `"none"` or `""` for no styling

### Supported Chalk Values

```typescript
type ChalkColorName = 
  // Basic colors
  | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray"
  // Bright variants
  | "blackBright" | "redBright" | "greenBright" | "yellowBright" 
  | "blueBright" | "magentaBright" | "cyanBright" | "whiteBright"
  // Modifiers
  | "bold" | "dim" | "italic" | "underline" | "strikethrough" | "inverse"
  // Special
  | "none";

type ChalkValue = ChalkColorName | ChalkColorName[] | string; // string allows "$primitive" refs
```

### Theme Extension

Themes can extend other themes using `"extends": "dark"` or `"extends": "light"`. Only the overridden values need to be specified.

**Example: Minimal override**

```json
{
  "name": "solarized-dark",
  "extends": "dark",
  "tokens": {
    "feedback": {
      "error": "magenta",
      "warning": "yellow"
    },
    "markdown": {
      "heading": {
        "h1": ["bold", "cyan"],
        "h2": ["bold", "blue"]
      }
    }
  }
}
```

### Loading Order

1. Load built-in themes (dark, light)
2. Scan `~/.pi/agent/themes/*.json`
3. Parse and validate each JSON theme
4. Build theme by:
   - Start with base theme (if extends specified)
   - Apply primitive overrides
   - Apply token overrides
   - Convert JSON values to chalk functions

## Implementation

### Theme Module Structure

**Location:** `packages/tui/src/theme/`

```
theme/
  ├── index.ts           # Public API
  ├── types.ts           # Type definitions
  ├── primitives.ts      # Color primitives for each theme
  ├── tokens.ts          # Semantic token mappings
  ├── themes.ts          # Built-in theme definitions
  ├── registry.ts        # Theme management (current, set, get)
  ├── loader.ts          # JSON theme loader
  └── parser.ts          # JSON to ChalkFunction converter
```

### Public API

```typescript
// packages/tui/src/theme/index.ts
export { type Theme, type SemanticTokens, type ColorPrimitives } from './types.js';
export { darkTheme, lightTheme } from './themes.js';
export { getTheme, setTheme, getThemeNames } from './registry.js';
```

### Theme Registry

```typescript
// packages/tui/src/theme/registry.ts
import { darkTheme, lightTheme } from './themes.js';
import type { Theme } from './types.js';

const themes = new Map<string, Theme>([
  ['dark', darkTheme],
  ['light', lightTheme],
]);

let currentTheme: Theme = darkTheme;

export function getTheme(): Theme {
  return currentTheme;
}

export function setTheme(name: string): void {
  const theme = themes.get(name);
  if (!theme) {
    throw new Error(`Theme "${name}" not found`);
  }
  currentTheme = theme;
}

export function getThemeNames(): string[] {
  return Array.from(themes.keys());
}

export function registerTheme(theme: Theme): void {
  themes.set(theme.name, theme);
}

export function getThemeByName(name: string): Theme | undefined {
  return themes.get(name);
}
```

### JSON Theme Parser

```typescript
// packages/tui/src/theme/parser.ts
import chalk from 'chalk';
import type { ChalkFunction } from './types.js';

type ChalkColorName = 
  | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray"
  | "blackBright" | "redBright" | "greenBright" | "yellowBright" 
  | "blueBright" | "magentaBright" | "cyanBright" | "whiteBright"
  | "bold" | "dim" | "italic" | "underline" | "strikethrough" | "inverse"
  | "none";

type JsonThemeValue = ChalkColorName | ChalkColorName[] | string;

interface JsonTheme {
  name: string;
  extends?: string;
  primitives?: Record<string, JsonThemeValue>;
  tokens?: any; // Partial<SemanticTokens> but with JsonThemeValue instead of ChalkFunction
}

// Map chalk color names to actual chalk functions
const chalkMap: Record<ChalkColorName, any> = {
  black: chalk.black,
  red: chalk.red,
  green: chalk.green,
  yellow: chalk.yellow,
  blue: chalk.blue,
  magenta: chalk.magenta,
  cyan: chalk.cyan,
  white: chalk.white,
  gray: chalk.gray,
  blackBright: chalk.blackBright,
  redBright: chalk.redBright,
  greenBright: chalk.greenBright,
  yellowBright: chalk.yellowBright,
  blueBright: chalk.blueBright,
  magentaBright: chalk.magentaBright,
  cyanBright: chalk.cyanBright,
  whiteBright: chalk.whiteBright,
  bold: chalk.bold,
  dim: chalk.dim,
  italic: chalk.italic,
  underline: chalk.underline,
  strikethrough: chalk.strikethrough,
  inverse: chalk.inverse,
  none: (s: string) => s,
};

export function parseThemeValue(
  value: JsonThemeValue,
  primitives?: Record<string, ChalkFunction>
): ChalkFunction {
  // Handle primitive reference: "$gray400"
  if (typeof value === 'string' && value.startsWith('

## Migration Strategy

### Phase 1: Infrastructure
1. Create theme module with types, primitives, and built-in themes
2. Export from `@mariozechner/pi-tui`
3. Add tests for theme functions

### Phase 2: Component Migration (Priority Order)
1. **Markdown** (biggest impact, 50+ color calls)
2. **ToolExecution** (stdout/stderr readability)
3. **SelectList** (used everywhere)
4. **Footer** (always visible)
5. **TuiRenderer** (logo, instructions)
6. Other components

### Phase 3: Persistence & UI
1. Add theme to SettingsManager
2. Create ThemeSelector component
3. Add `/theme` slash command
4. Initialize theme on startup

### Example Migration

**Before:**
```typescript
// markdown.ts
if (headingLevel === 1) {
  lines.push(chalk.bold.underline.yellow(headingText));
} else if (headingLevel === 2) {
  lines.push(chalk.bold.yellow(headingText));
} else {
  lines.push(chalk.bold(headingPrefix + headingText));
}
```

**After:**
```typescript
// markdown.ts
import { getTheme } from '@mariozechner/pi-tui/theme';

const theme = getTheme();
if (headingLevel === 1) {
  lines.push(theme.tokens.markdown.heading.h1(headingText));
} else if (headingLevel === 2) {
  lines.push(theme.tokens.markdown.heading.h2(headingText));
} else {
  lines.push(theme.tokens.markdown.heading.h3(headingPrefix + headingText));
}
```

## Benefits of This Approach

1. **Separation of Concerns**: Color values (primitives) separate from usage (tokens)
2. **Maintainable**: Change all headings by editing one token mapping
3. **Extensible**: Easy to add new themes without touching components
4. **Type-safe**: Full TypeScript support
5. **Testable**: Can test themes independently
6. **Minimal**: Only what we need, no over-engineering
7. **Composable**: Can chain primitives (bold + underline + color)

## Key Differences from Themes.md

- **Two-layer system**: Primitives + Semantic tokens (vs. flat theme object)
- **Composability**: Can combine primitive modifiers
- **Better light theme**: Properly handles chalk.dim and color visibility issues
- **More organized**: Tokens grouped by purpose (text, interactive, markdown, etc.)
- **Easier to extend**: Add new token without changing primitives
- **Better for sharing**: Could export just primitives for custom themes
)) {
    const primitiveName = value.slice(1);
    if (primitives && primitives[primitiveName]) {
      return primitives[primitiveName];
    }
    throw new Error(`Primitive reference "${value}" not found`);
  }
  
  // Handle array of chalk names (composition): ["bold", "blue"]
  if (Array.isArray(value)) {
    return (str: string) => {
      let result = str;
      for (const name of value) {
        const chalkFn = chalkMap[name as ChalkColorName];
        if (!chalkFn) {
          throw new Error(`Unknown chalk function: ${name}`);
        }
        result = chalkFn(result);
      }
      return result;
    };
  }
  
  // Handle single chalk name: "blue"
  if (typeof value === 'string') {
    const chalkFn = chalkMap[value as ChalkColorName];
    if (!chalkFn) {
      throw new Error(`Unknown chalk function: ${value}`);
    }
    return chalkFn;
  }
  
  throw new Error(`Invalid theme value: ${JSON.stringify(value)}`);
}

// Deep merge objects, used for extending themes
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}

export function parseJsonTheme(json: JsonTheme, baseTheme?: Theme): Theme {
  // Start with base theme if extending
  let primitives: Record<string, ChalkFunction> = {};
  let tokens: any = {};
  
  if (json.extends && baseTheme) {
    // Copy base theme primitives and tokens
    primitives = { ...baseTheme.primitives };
    tokens = deepMerge({}, baseTheme.tokens);
  }
  
  // Parse and override primitives
  if (json.primitives) {
    for (const [key, value] of Object.entries(json.primitives)) {
      primitives[key] = parseThemeValue(value, primitives);
    }
  }
  
  // Parse and override tokens (recursive)
  if (json.tokens) {
    const parsedTokens = parseTokens(json.tokens, primitives);
    tokens = deepMerge(tokens, parsedTokens);
  }
  
  return {
    name: json.name,
    primitives,
    tokens,
  };
}

function parseTokens(obj: any, primitives: Record<string, ChalkFunction>): any {
  const result: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Nested object, recurse
      result[key] = parseTokens(value, primitives);
    } else {
      // Leaf value, parse it
      result[key] = parseThemeValue(value as JsonThemeValue, primitives);
    }
  }
  
  return result;
}
```

### JSON Theme Loader

```typescript
// packages/tui/src/theme/loader.ts
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseJsonTheme } from './parser.js';
import { getThemeByName, registerTheme } from './registry.js';
import type { Theme } from './types.js';

export function loadUserThemes(themesDir: string): Theme[] {
  const themes: Theme[] = [];
  
  if (!existsSync(themesDir)) {
    return themes;
  }
  
  const files = readdirSync(themesDir).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const content = readFileSync(join(themesDir, file), 'utf-8');
      const json = JSON.parse(content);
      
      // Get base theme if extending
      let baseTheme: Theme | undefined;
      if (json.extends) {
        baseTheme = getThemeByName(json.extends);
        if (!baseTheme) {
          console.warn(`Theme ${json.name} extends unknown theme "${json.extends}", skipping`);
          continue;
        }
      }
      
      const theme = parseJsonTheme(json, baseTheme);
      registerTheme(theme);
      themes.push(theme);
    } catch (error) {
      console.error(`Failed to load theme from ${file}:`, error);
    }
  }
  
  return themes;
}
```

## Migration Strategy

### Phase 1: Infrastructure
1. Create theme module with types, primitives, and built-in themes
2. Export from `@mariozechner/pi-tui`
3. Add tests for theme functions

### Phase 2: Component Migration (Priority Order)
1. **Markdown** (biggest impact, 50+ color calls)
2. **ToolExecution** (stdout/stderr readability)
3. **SelectList** (used everywhere)
4. **Footer** (always visible)
5. **TuiRenderer** (logo, instructions)
6. Other components

### Phase 3: Persistence & UI
1. Add theme to SettingsManager
2. Create ThemeSelector component
3. Add `/theme` slash command
4. Initialize theme on startup

### Example Migration

**Before:**
```typescript
// markdown.ts
if (headingLevel === 1) {
  lines.push(chalk.bold.underline.yellow(headingText));
} else if (headingLevel === 2) {
  lines.push(chalk.bold.yellow(headingText));
} else {
  lines.push(chalk.bold(headingPrefix + headingText));
}
```

**After:**
```typescript
// markdown.ts
import { getTheme } from '@mariozechner/pi-tui/theme';

const theme = getTheme();
if (headingLevel === 1) {
  lines.push(theme.tokens.markdown.heading.h1(headingText));
} else if (headingLevel === 2) {
  lines.push(theme.tokens.markdown.heading.h2(headingText));
} else {
  lines.push(theme.tokens.markdown.heading.h3(headingPrefix + headingText));
}
```

## Benefits of This Approach

1. **Separation of Concerns**: Color values (primitives) separate from usage (tokens)
2. **Maintainable**: Change all headings by editing one token mapping
3. **Extensible**: Easy to add new themes without touching components
4. **Type-safe**: Full TypeScript support
5. **Testable**: Can test themes independently
6. **Minimal**: Only what we need, no over-engineering
7. **Composable**: Can chain primitives (bold + underline + color)

## Key Differences from Themes.md

- **Two-layer system**: Primitives + Semantic tokens (vs. flat theme object)
- **Composability**: Can combine primitive modifiers
- **Better light theme**: Properly handles chalk.dim and color visibility issues
- **More organized**: Tokens grouped by purpose (text, interactive, markdown, etc.)
- **Easier to extend**: Add new token without changing primitives
- **Better for sharing**: Could export just primitives for custom themes
