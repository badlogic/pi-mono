# Pi context

Canonical language for Pi-specific product and extension concepts.

## Language

**Visual profile**:
An opt-in extension module that gives Pi's built-in TUI surfaces one coordinated presentation while preserving their behavior and leaving third-party self-rendered components unchanged.
_Avoid_: Renderer, skin, theme package

**Visual profile package**:
The installable package containing the visual profile, its themes and documentation, and the separately owned queue extension module.
_Avoid_: Footer extension, renderer package
