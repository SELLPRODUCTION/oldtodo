#pragma once
// Libraries
#include <string.h>

// Scripts
#include "common/context.h"



// Void functions
void deleteTask(Context *ctx);
void createTask(Context *ctx);
void markTaskCompleted(Context *ctx);
void loadTasks(Context *ctx);
void taskEdit(Context *ctx);