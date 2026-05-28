
#pragma once

#include "data_type.h"

typedef struct {
    const char *name;
    const char *description;
    DataType type;
    size_t offset;
} Field;