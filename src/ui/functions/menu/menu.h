#pragma once

#include "common/context.h"

// Int functions
int menu();

// Void functions
void viewTasks(Context *ctx);
void createTaskOption(Context *ctx);
void markTaskCompletedOption(Context *ctx);
void deleteTaskOption(Context *ctx);
void exitProgram(); 