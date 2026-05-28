// Libaries
#include <stdio.h>

// Scripts
#include "log.h"
#include "common/context.h"
#include "core/functions/file_manager/file.h"

void createLogFile() {
    createFile("logs/log.txt");
}