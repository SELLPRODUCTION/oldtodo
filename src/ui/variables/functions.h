#pragma once
#include "common/context.h"

typedef void (*Action)(Context *);

typedef struct {
  Action action;
  char description[100];
} Functions;
