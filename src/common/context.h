#pragma once
#include "core/variables/task.h"
#include "core/variables/time.h"

typedef struct {
    int count;

    char name[100];
    char description[100];
    
    int id;
    
    DateTime timestamp;

    size_t idOfSelectedTask;
} Context;