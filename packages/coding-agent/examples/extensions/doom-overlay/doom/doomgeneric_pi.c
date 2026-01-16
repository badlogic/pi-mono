/**
 * pi-doom platform implementation for doomgeneric
 *
 * Minimal implementation - no sound, just framebuffer and input.
 */

#include "doomgeneric.h"
#include "doomkeys.h"
#include <emscripten.h>
#include <stdint.h>

// Key event queue
#define KEY_QUEUE_SIZE 256
static struct {
  int pressed;
  unsigned char key;
} key_queue[KEY_QUEUE_SIZE];
static int key_queue_read = 0;
static int key_queue_write = 0;

// Get the framebuffer pointer for JS to read
EMSCRIPTEN_KEEPALIVE
uint32_t *DG_GetFrameBuffer(void) { return DG_ScreenBuffer; }

// Get framebuffer dimensions
EMSCRIPTEN_KEEPALIVE
int DG_GetScreenWidth(void) { return DOOMGENERIC_RESX; }

EMSCRIPTEN_KEEPALIVE
int DG_GetScreenHeight(void) { return DOOMGENERIC_RESY; }

// Push a key event from JavaScript
EMSCRIPTEN_KEEPALIVE
void DG_PushKeyEvent(int pressed, unsigned char key) {
  int next_write = (key_queue_write + 1) % KEY_QUEUE_SIZE;
  if (next_write != key_queue_read) {
    key_queue[key_queue_write].pressed = pressed;
    key_queue[key_queue_write].key = key;
    key_queue_write = next_write;
  }
}

void DG_Init(void) {
  // Nothing to initialize
}

void DG_DrawFrame(void) {
  // Frame is in DG_ScreenBuffer, JS reads via DG_GetFrameBuffer
}

void DG_SleepMs(uint32_t ms) {
  // No-op - JS handles timing
  (void)ms;
}

uint32_t DG_GetTicksMs(void) {
  return (uint32_t)emscripten_get_now();
}

int DG_GetKey(int *pressed, unsigned char *key) {
  if (key_queue_read != key_queue_write) {
    *pressed = key_queue[key_queue_read].pressed;
    *key = key_queue[key_queue_read].key;
    key_queue_read = (key_queue_read + 1) % KEY_QUEUE_SIZE;
    return 1;
  }
  return 0;
}

void DG_SetWindowTitle(const char *title) {
  (void)title;
}
