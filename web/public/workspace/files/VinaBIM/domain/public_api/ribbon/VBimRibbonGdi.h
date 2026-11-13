/**
 * @file VBimRibbonGdi.h
 * @brief Procedural GDI and Vector Drawing Utilities for VinaBIM Ribbon controls.
 *
 * Provides inline helpers to dynamically synthesize 32-bit ARGB Win32 HICON
 * handles at runtime using standard GDI or GDI+ rendering.
 */

#pragma once

#include <windows.h>
#include <functional>
#include <cstdint>
#include "VBimRibbonTypes.h"

namespace VBimRibbon
{
    /**
     * @brief Synthesizes a 32-bit ARGB Win32 HICON handle via procedural GDI drawing.
     * @details Allocates a transparent 32-bit top-down DIBSection, sets up an in-memory
     *          device context, and invokes @p drawFn. Automatically assigns 100% alpha (0xFF)
     *          to all drawn non-zero RGB pixels while preserving full transparency for untouched areas.
     * @param width Desired icon width in pixels (typically 16 or 32).
     * @param height Desired icon height in pixels (typically 16 or 32).
     * @param drawFn Callback receiving (HDC hdc, int width, int height) to render CAD vectors/shapes.
     * @return Newly created HICON with 32-bit alpha transparency, or nullptr on failure.
     */
    inline HICON CreateGdiIcon(int width, int height, const std::function<void(HDC hdc, int width, int height)>& drawFn)
    {
        if (width <= 0 || height <= 0 || !drawFn)
            return nullptr;

        BITMAPINFO bi = { 0 };
        bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        bi.bmiHeader.biWidth = width;
        bi.bmiHeader.biHeight = -height; // Top-down DIB
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB;

        void* pBits = nullptr;
        HDC hdcScreen = ::GetDC(nullptr);
        HDC hdcMem = ::CreateCompatibleDC(hdcScreen);
        HBITMAP hbmColor = ::CreateDIBSection(hdcScreen, &bi, DIB_RGB_COLORS, &pBits, nullptr, 0);
        ::ReleaseDC(nullptr, hdcScreen);

        if (!hbmColor || !pBits || !hdcMem)
        {
            if (hbmColor) ::DeleteObject(hbmColor);
            if (hdcMem) ::DeleteDC(hdcMem);
            return nullptr;
        }

        // Fill with a sentinel background color to distinguish untouched background
        // from pixels intentionally drawn with black RGB(0, 0, 0).
        constexpr uint32_t kSentinel = 0x00010203;
        uint32_t* pPixels = static_cast<uint32_t*>(pBits);
        const int totalPixels = width * height;
        for (int i = 0; i < totalPixels; ++i)
        {
            pPixels[i] = kSentinel;
        }

        HGDIOBJ hOldBmp = ::SelectObject(hdcMem, hbmColor);

        // Execute procedural drawing
        drawFn(hdcMem, width, height);

        ::GdiFlush();

        // Process alpha: untouched pixels become fully transparent, while drawn pixels
        // (including black RGB(0,0,0) without GDI alpha) receive 100% alpha (0xFF).
        for (int i = 0; i < totalPixels; ++i)
        {
            const uint32_t pixel = pPixels[i];
            if ((pixel & 0x00FFFFFF) == kSentinel)
            {
                pPixels[i] = 0; // Untouched background is 100% transparent
            }
            else if ((pixel & 0xFF000000) == 0)
            {
                pPixels[i] = (pixel & 0x00FFFFFF) | 0xFF000000;
            }
        }

        BITMAPINFO biMask = { 0 };
        biMask.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        biMask.bmiHeader.biWidth = width;
        biMask.bmiHeader.biHeight = height;
        biMask.bmiHeader.biPlanes = 1;
        biMask.bmiHeader.biBitCount = 1;
        void* pMaskBits = nullptr;
        HBITMAP hbmMask = ::CreateDIBSection(nullptr, &biMask, DIB_RGB_COLORS, &pMaskBits, nullptr, 0);

        ICONINFO ii = { 0 };
        ii.fIcon = TRUE;
        ii.hbmMask = hbmMask;
        ii.hbmColor = hbmColor;

        HICON hIcon = ::CreateIconIndirect(&ii);

        ::SelectObject(hdcMem, hOldBmp);
        ::DeleteDC(hdcMem);
        ::DeleteObject(hbmColor);
        if (hbmMask)
            ::DeleteObject(hbmMask);

        return hIcon;
    }
}
