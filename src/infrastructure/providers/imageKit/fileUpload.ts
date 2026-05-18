import ImageKit from 'imagekit';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../../config';

const imagekit = new ImageKit({
  publicKey: config.client.mediaClient.imageKit.publicKey,
  privateKey: config.client.mediaClient.imageKit.privateKey,
  urlEndpoint: config.client.mediaClient.imageKit.urlEndpoint,
});

export const uploadImageToImageKit = async (
  file: any,
  folder: string,
): Promise<any> => {
  try {
    return await imagekit.upload({
      file: file.buffer,
      fileName: file.originalname,
      folder,
    });
  } catch (error) {
    throw new Error(`Error while uploading image: ${error}`);
  }
};

// export const uploadImage = async (file: any, folder: string) => {
//   let fileData: string | fs.ReadStream | Buffer;

//   if (file.buffer) {
//     fileData = file.buffer;
//   } else if (file.path) {
//     fileData = fs.createReadStream(file.path);
//   } else {
//     throw new Error("Invalid file format");
//   }

//   return await imagekit.upload({
//     file: fileData,
//     fileName: file.originalname || file.filename || "uploaded-file",
//     folder,
//   });
// };

export const uploadBase64Image = async (
  base64Image: string,
  folder: string,
) => {
  // Remove the data:image/[type];base64, part if it exists
  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
  // Generate a unique filename
  const fileName = `${uuidv4()}.jpg`; // Assuming JPEG, adjust if needed
  try {
    const result = await imagekit.upload({
      file: base64Data,
      fileName: fileName,
      folder: folder,
    });

    return {
      url: result.url,
      fileId: result.fileId,
      name: result.name,
    };
  } catch (error) {
    console.error('Error uploading image to ImageKit:', error);
    throw new Error('Failed to upload image');
  }
};

export const updateImageOnImageKit = async (
  file: any,
  folder: string,
  fileId?: string,
): Promise<any> => {
  try {
    if (fileId) {
      const deletedImage = await imagekit.deleteFile(fileId);
      if (deletedImage) {
        return await imagekit.upload({
          file: file.buffer,
          fileName: file.originalname,
          folder,
        });
      } else {
        return await imagekit.upload({
          file: file.buffer,
          fileName: file.originalname,
          folder,
        });
      }
    } else {
      return await imagekit.upload({
        file: file.buffer,
        fileName: file.originalname,
        folder,
      });
    }
  } catch (error) {
    throw new Error(`Error while uploading image: ${error}`);
  }
};

export const deleteImageOnImageKit = async (file_id: string): Promise<any> => {
  try {
    const deleted_data = await imagekit.deleteFile(file_id);
    return {
      status: true,
      message: 'File deleted successfully',
      data: deleted_data,
    };
  } catch (error: any) {
    return { status: false, message: error.message };
  }
};

export const getImage = async (file_id: string): Promise<any> => {
  try {
    const fileExists = await imagekit.getFileDetails(file_id);
    if (!fileExists) {
      return {
        status: false,
        message: 'File does not exist',
      };
    }
    return {
      status: true,
      message: 'File exists',
      data: fileExists,
    };
  } catch (error: any) {
    return { status: false, message: error.message };
  }
};
