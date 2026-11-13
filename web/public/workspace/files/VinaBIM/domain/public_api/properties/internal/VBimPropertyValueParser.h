#pragma once

#include "OdaCommon.h"
#include "Base/BmObjectId.h"

class OdBmDatabase;

/**
 * @file VBimPropertyValueParser.h
 * @brief Host-internal parsing of staged property text into the values Sync() writes.
 *
 * Shared by VBimElementProperties and VBimProjectProperties so that SetProperty()
 * validation and Sync() writes accept exactly the same text. Not part of the plugin API.
 */
namespace vb::properties::detail
{
    /**
     * @brief Parses text staged for an Integer parameter.
     * @param pDb Database owning the parameter; may be null (no choice lookup).
     * @param paramId Parameter id (user parameter, or the database id of a built-in); may be null.
     * @param text Yes/No, True/False, On/Off, a whole decimal number, or a choice's display text.
     * @param outValue Receives the parsed value on success.
     * @return true when the whole text was understood; false for empty or unparsable text.
     */
    bool ParseIntegerValue(OdBmDatabase* pDb, const OdBmObjectId& paramId, const OdString& text, OdInt32& outValue);

    /**
     * @brief Parses text staged for a Double parameter and converts it to internal units.
     * @param pDb Database whose project units define the display unit; may be null (no conversion).
     * @param paramId Parameter id (user parameter, or the database id of a built-in); may be null.
     * @param text A number in display units, optionally followed by a unit symbol (e.g. "3000 mm").
     *  Text with more digits after the number (e.g. feet-inches "3' 6\"") is rejected.
     * @param outInternalValue Receives the value in internal units on success.
     * @return true when the text holds a finite number; false otherwise.
     */
    bool ParseDoubleValue(OdBmDatabase* pDb, const OdBmObjectId& paramId, const OdString& text, double& outInternalValue);
}
