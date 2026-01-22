'
'   QUICKBASIC SUPPORT ROUTINES FOR THEDRAW OBJECT FILES
'-----------------------------------------------------------------------------
'   Compatible with Microsoft QuickBasic v4.0 and v4.5 text modes.
'-----------------------------------------------------------------------------
'
'   There are a few routines within the QB4UTIL.LIB file.  These are
'   (along with brief descriptions):
'
'     UNCRUNCH          - Flash display routine for crunched image files.
'     ASCIIDISPLAY      - Display routine for ascii only image files.
'     NORMALDISPLAY     - Display routine for normal full binary image files.
'     INITSCREENARRAY   - Maps a dynamic integer array to the physical video
'                         memory.
'
'=============================================================================
'   UNCRUNCH (imagedata,video offset)
'   ASCIIDISPLAY (imagedata,video offset)
'   NORMALDISPLAY (imagedata,video offset)
'=============================================================================
'
'   These three subroutines operate similarly.  Each takes a specific data
'   format (TheDraw crunched data, ascii only, or normal binary) and displays
'   the image on the screen.  Monochrome and color text video displays are
'   supported.  The integer offset parameter is useful with block images,
'   giving control over where the block appears.
'
'   Example calls:
'     CALL UNCRUNCH (ImageData&,vidoffset%)        <- for crunched data
'     CALL ASCIIDISPLAY (ImageData&,vidoffset%)    <- for ascii-only data
'     CALL NORMALDISPLAY (ImageData&,vidoffset%)   <- for normal binary data
'
'   The parameter IMAGEDATA is the identifier you assign when saving
'   a QuickBasic object file with TheDraw.  ImageData actually becomes a
'   short function returning information Uncrunch, AsciiDisplay, and
'   NormalDisplay use to find the screen contents.  In addition, three
'   other related integer functions are created.  Assuming the identifier
'   IMAGEDATA, these are:
'
'         IMAGEDATAWIDTH%
'         IMAGEDATADEPTH%
'         IMAGEDATALENGTH%
'
'   The width and depth functions return the size of the block in final
'   form (ie: a full screen would yield the numbers 80 and 25 respectfully).
'   The length function returns the size of the stored data.  For crunched
'   files and block saves this might be very small.  For a 80x25 full screen
'   binary image it will be 4000 bytes.  The integer functions are useful for
'   computing screen or window dimensions, etc...
'
'   You must declare all four functions in your Basic source code before
'   they can be used (naturally).  The following code example illustrates.
'   The identifier used is IMAGEDATA.  The data is a 40 character by 10 line
'   block saved as normal binary.
'
'     ----------------------------------------------------------------------
'       REM $INCLUDE: 'QB4UTIL.BI'
'       DECLARE FUNCTION ImageData&         ' Important!  Do not neglect
'       DECLARE FUNCTION ImageDataWidth%    ' the "&" and "%" symbols
'       DECLARE FUNCTION ImageDataDepth%    ' after the function names.
'       DECLARE FUNCTION ImageDataLength%
'
'       CALL NORMALDISPLAY (ImageData&, 34 *2+( 5 *160)-162)
'     ----------------------------------------------------------------------
'
'   That's it!  The above displays the 40x10 block at screen coordinates
'   column 34, line 5 (note these two numbers in above example).  If the
'   data was crunched or ascii use the corresponding routine.
'
'      Note: The ascii-only screen image does not have any color controls.
'            Whatever the on-screen colors were before, they will be after.
'            You might want to insert COLOR and CLS statements before calling
'            the ASCIIDISPLAY routine.
'
'   Regardless of which routine used, each remembers the original horizontal
'   starting column when it goes to the next line.  This permits a block to
'   be displayed correctly anywhere on the screen.  ie:
'
'       +-------------------------------------------------+
'       |                                                 |
'       |                                                 | <- Pretend this
'       |                                                 |    is the video
'       |           ÚÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ¿               |    display.
'       |           ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³               |
'       |           ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³               |
'       |           ³ÛÛ ImageData block ÛÛ³               |
'       |           ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³               |
'       |           ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³               |
'       |           ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³               |
'       |           ÀÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÙ               |
'       |                                                 |
'       |                                                 |
'       |                                                 |
'       +-------------------------------------------------+
'
'
'   The ImageData block could be shown in the upper-left corner of the
'   screen by changing the call to:
'
'         CALL NORMALDISPLAY (ImageData&,0)
'
'   Notice the video offset has been removed, since we want the upper-left
'   corner.  To display the block in the lower-right corner you would use:
'
'         CALL NORMALDISPLAY (ImageData&, 40 *2+( 15 *160)-162)
'
'   The block is 40 characters wide by 10 lines deep.  Therefore to display
'   such a large block, we must display the block at column 40, line 15.
'   (column 80 minus 40, line 25 minus 10).
'
'
' NOTES ON THE UNCRUNCH ROUTINE
' --------------------------------------------------------------------------
'
'   Many people favor "crunching" screens with TheDraw because the size
'   of the data generally goes down.  When uncrunching an image however,
'   there is no guarantee what was previously on-screen will be replaced.
'
'   In particular, the uncruncher assumes the screen is previously erased to
'   black thus permitting better data compression.  For instance, assume the
'   video completely filled with blocks, overwritten by an uncrunched image:
'
'      ÚÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ¿            ÚÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ¿
'      ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³            ³tetetetetetÛÛÛÛÛÛÛÛÛÛ³
'      ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³            ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³
'      ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³            ³    eteteteteteteÛÛÛÛ³
'      ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³            ³tetetetetÛÛÛÛÛÛÛÛÛÛÛÛ³
'      ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³            ³         eteÛÛÛÛÛÛÛÛÛ³
'      ³ÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛÛ³            ³       etetetetetetÛÛ³
'      ÀÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÙ            ÀÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÙ
'          before uncrunch                    after uncrunch
'
'   By omitting a CLS statement, the new text appears surrounded by bits of
'   the previous screen.  Proper usage would typically be:
'
'     ----------------------------------------------------------------------
'       REM $INCLUDE: 'QB4UTIL.BI'
'       DECLARE FUNCTION ImageData&         ' Important!  Do not neglect
'       DECLARE FUNCTION ImageDataWidth%    ' the "&" and "%" symbols
'       DECLARE FUNCTION ImageDataDepth%    ' after the function names.
'       DECLARE FUNCTION ImageDataLength%
'
'       COLOR 15,0 : CLS                      ' Clear to black screen
'       CALL UNCRUNCH (ImageData&, 34 *2+( 5 *160)-162)
'     ----------------------------------------------------------------------
'
'
'=============================================================================
'   INITSCREENARRAY
'=============================================================================
'
'   To directly access the video screen memory requires you to use the
'   PEEK/POKE statements after setting the DEF SEG value.  A cumbersome
'   and compiler inefficient approach.  In addition, you must have some
'   way of determining if a monochrome or color video is being used before
'   the DEF SEG can be set properly.
'
'   This subroutine offers a simpler approach, by effectively mapping or
'   placing an integer array over the video screen.  Instead of PEEK/POKE,
'   you merely reference an array element.  ie:
'
'     ----------------------------------------------------------------------
'       REM $INCLUDE: 'QB4UTIL.BI'
'
'       REM $DYNAMIC    <- very important to place this before DIM statement
'       DIM S%(0)
'       CALL INITSCREENARRAY (S%())
'
'       S%(0) = ASC("H") + 15 *256 + 1 *4096
'       S%(1) = ASC("E") + 15 *256 + 1 *4096
'       S%(2) = ASC("L") + 15 *256 + 1 *4096
'       S%(3) = ASC("L") + 15 *256 + 1 *4096
'       S%(4) = ASC("O") + 15 *256 + 1 *4096
'     ----------------------------------------------------------------------
'
'   The above example directly places the message "HELLO" on the screen
'   for you, in white lettering (the 15*256) on a blue background (1*4096).
'   To alter the foreground color, change the 15's to some other number.
'   Change the 1's for the background color.
'
'   Each array element contains both the character to display plus the
'   color information.  This explains the bit of math following each
'   ASC statement.  You could minimize this using a FOR/NEXT loop.
'
'   The S% array has 2000 elements (0 to 1999) representing the entire
'   80 by 25 line video.  If in an EGA/VGA screen mode change the 1999 to
'   3439 or 3999 respectfully.
'
'   There is no pressing reason to use the array approach, however it
'   does free up the DEFSEG/PEEK/POKE combination for other uses.  In
'   any case, enjoy!
'
'
DECLARE SUB UNCRUNCH (X&, Z%)
DECLARE SUB ASCIIDISPLAY (X&, Z%)
DECLARE SUB NORMALDISPLAY (X&, Z%)
DECLARE SUB INITSCREENARRAY (A%())
