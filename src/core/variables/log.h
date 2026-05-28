#pragma once
#include "core/variables/time.h"

typedef struct {
  char type[50];
  char message[256];
  char data;
  DateTime timestamp;
} Log;