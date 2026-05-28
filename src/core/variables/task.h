#pragma once
// Libraries
#include <stddef.h>
// Scripts
#include "common/field.h"
typedef struct {
  int id;
  char name[100];
  char description[100];
  
  int status; // 0 for incomplete, 1 for completed
} Task;

static const Field taskFields[] = {
    {"id", "Unique identifier", FT_INT, offsetof(Task, id)},
    {"name", "Name", FT_STRING, offsetof(Task, name)},
    {"description", "Description", FT_STRING, offsetof(Task, description)},
    {"status", "Status", FT_INT, offsetof(Task, status)},
};
