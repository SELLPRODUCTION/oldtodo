#ifndef TYPE_NAME_H
#define TYPE_NAME_H

#define TYPE_NAME(x) _Generic((x), \
    int: "int", \
    float: "float", \
    double: "double", \
    char: "char", \
    default: "other")

#endif