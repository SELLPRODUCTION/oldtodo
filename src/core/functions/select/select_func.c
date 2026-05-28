#include <stdio.h>

size_t selectFunc() {
  size_t choice;
  while (scanf("%zu%*c", &choice) != 1) {
    while (getchar() != '\n');
  }
  return choice;
}