#pragma once

#include <string.h>

void createFile(const char *filename);
void writeToFile(const char *filename, const Field *fields, int count, const void *data);
void deleteFile(const char *filename);

FILE *openFile(const char *filename, const char *mode);

int readFromFile(const char *filename, const Field *fields, int count, void *data);