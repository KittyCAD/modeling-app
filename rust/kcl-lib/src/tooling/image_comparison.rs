pub const DEFAULT_MIN_SIMILARITY: f64 = 0.99;

#[derive(Debug)]
pub struct ImageComparison {
    pub similarity: f64,
    pub difference: f64,
    pub diff_image: image::DynamicImage,
}

pub fn compare_images(
    left: &image::DynamicImage,
    right: &image::DynamicImage,
) -> Result<ImageComparison, image_compare::CompareError> {
    let result = image_compare::rgba_hybrid_compare(&left.to_rgba8(), &right.to_rgba8())?;
    let difference = result.score.clamp(0.0, 1.0);
    let similarity = (1.0 - difference).clamp(0.0, 1.0);

    Ok(ImageComparison {
        similarity,
        difference,
        diff_image: result.image.to_color_map(),
    })
}

#[cfg(test)]
mod tests {
    use image::DynamicImage;
    use image::Rgba;
    use image::RgbaImage;

    use super::compare_images;

    #[test]
    fn identical_images_have_full_similarity() {
        let mut image = RgbaImage::new(1, 1);
        image.put_pixel(0, 0, Rgba([0, 0, 0, 255]));
        let image = DynamicImage::ImageRgba8(image);

        let comparison = compare_images(&image, &image).unwrap();

        assert_eq!(comparison.similarity, 1.0);
        assert_eq!(comparison.difference, 0.0);
    }
}
