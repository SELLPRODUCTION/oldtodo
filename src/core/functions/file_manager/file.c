// Libraries
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <dirent.h>

// Scripts
#include "common/context.h"

void createFile(const char *filename) {
    FILE *file = fopen(filename, "w");
    if (file == NULL) {
        perror("Error creating file");
        return;
    }
    fclose(file);
}
void writeToFile(const char *filename, const Field *fields, int count, const void *data) {
    FILE *f = fopen(filename, "w");
    if (!f) {
        perror("fopen");
        return;
    }

    const char *base = (const char *)data;


    for (int i = 0; i < count; i++) {

        const void *fieldPtr = base + fields[i].offset;

        switch (fields[i].type) {

            case FT_INT: {
                int value = *(const int *)fieldPtr;
                fprintf(f, "%s: %d\n", fields[i].name, value);
                break;
            }

           case FT_STRING: {
            const char *str = (const char *)fieldPtr;
            fprintf(f, "%s: %s\n", fields[i].name, str);
            break;
        }

            default:
                fprintf(f, "%s: [unsupported]\n", fields[i].name);
                break;
        }
    }

    fclose(f);
}
void deleteFile(const char *filename) {
    if (remove(filename) != 0) {
        perror("Error deleting file");
    }
}

FILE *openFile(const char *filename, const char *mode) {
    FILE *file = fopen(filename, mode);
    if (file == NULL) {
        perror("Error opening file");
    }
    return file;
}


int readFromFile(const char *filename, const Field *fields, int count, void *data){
    FILE *f = fopen(filename, "r");
    if (!f) return -1;

    char line[256];

    while (fgets(line, sizeof(line), f)) {

        line[strcspn(line, "\n")] = 0;

        char *sep = strstr(line, ": ");
        if (!sep) continue;

        *sep = '\0';

        char *key = line;
        char *value = sep + 2;

        for (int i = 0; i < count; i++) {

            if (strcmp(fields[i].name, key) == 0) {

                void *fieldPtr = (char *)data + fields[i].offset;

                if (fields[i].type == FT_INT) {
                    *(int *)fieldPtr = atoi(value);
                }
                else if (fields[i].type == FT_STRING) {
                    strncpy((char *)fieldPtr, value, 99);
                    ((char *)fieldPtr)[99] = '\0';
                }

                break;
            }
        }
    }

    fclose(f);
    return 0;
}

int getCountOfFiles(const char *stream){
    DIR *dir = opendir(stream);
    
    if (!dir) {
        perror("opendir");
        return 1;
    }

    struct dirent *entry;

    while ((entry = readdir(dir)) != NULL) {
        printf("%s\n", entry->d_name);
    }

    closedir(dir);
    return 0;
}
